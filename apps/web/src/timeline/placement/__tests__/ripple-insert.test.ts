import { describe, expect, mock, test } from "bun:test";
import type {
	GraphicElement,
	GraphicTrack,
	SceneTracks,
	VideoElement,
	VideoTrack,
} from "@/timeline";

// Timeline tests express positions in tiny raw ticks (1 tick = 1 second), so
// stub the tick lattice instead of using the real 120000-ticks/s constants.
mock.module("@/wasm/time-math", () => ({
	TICKS_PER_SECOND: 1,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds),
	mediaTimeToSeconds: ({ time }: { time: number }) => time,
	roundToFrame: ({ time }: { time: number }) => time,
	floorToFrame: ({ time }: { time: number }) => time,
	isFrameAligned: () => true,
	mediaTimeFromFrame: ({ frame }: { frame: number }) => frame,
	snappedSeekTime: ({ time }: { time: number }) => time,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	parseTimecode: () => null,
	formatTimecode: () => "",
	guessTimecodeFormat: () => undefined,
	ticksPerFrame: () => 1,
}));

const [
	{ applyRippleInsert, applyTimelineRippleInsert, applyTrackRippleInsert },
	{ computeDropTarget },
	{ mediaTime, ZERO_MEDIA_TIME },
] = await Promise.all([
	import("@/timeline/placement"),
	import("@/timeline/components/drop-target"),
	import("@/wasm"),
]);

function buildGraphicElement({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): GraphicElement {
	return {
		id,
		type: "graphic",
		name: id,
		startTime: mediaTime({ ticks: startTime }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		definitionId: `graphic-${id}`,
		params: {
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		},
	};
}

function buildVideoElement({
	id,
	startTime,
	duration,
}: {
	id: string;
	startTime: number;
	duration: number;
}): VideoElement {
	return {
		id,
		type: "video",
		name: id,
		startTime: mediaTime({ ticks: startTime }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		},
	};
}

function buildTracks({
	elements = [],
	videoElements = [],
}: {
	elements?: GraphicElement[];
	videoElements?: VideoElement[];
}): SceneTracks {
	const graphicTrack: GraphicTrack = {
		id: "graphic-1",
		type: "graphic",
		name: "Graphic",
		hidden: false,
		elements,
	};

	const mainTrack: VideoTrack = {
		id: "main",
		type: "video",
		name: "Main",
		muted: false,
		hidden: false,
		elements: videoElements,
	};

	return {
		overlay: [graphicTrack],
		main: mainTrack,
		audio: [],
	};
}

describe("ripple insert", () => {
	test("shifts elements at and after the insert time", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({ id: "before", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "at", startTime: 10, duration: 5 }),
				buildGraphicElement({ id: "after", startTime: 20, duration: 5 }),
			],
		});

		const updated = applyRippleInsert({
			tracks,
			targetTrackId: "graphic-1",
			insertTime: mediaTime({ ticks: 10 }),
			duration: mediaTime({ ticks: 4 }),
		});

		expect(
			updated?.overlay[0].elements.map((element) => element.startTime),
		).toEqual([0, 14, 24].map((ticks) => mediaTime({ ticks })));
	});

	test("does not insert through the middle of an existing element", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({ id: "existing", startTime: 0, duration: 10 }),
			],
		});

		const updated = applyRippleInsert({
			tracks,
			targetTrackId: "graphic-1",
			insertTime: mediaTime({ ticks: 5 }),
			duration: mediaTime({ ticks: 4 }),
		});

		expect(updated).toBeNull();
	});

	test("track ripple shifts only the target track, leaving others untouched", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({ id: "graphic-before", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "graphic-after", startTime: 10, duration: 5 }),
			],
			videoElements: [
				buildVideoElement({ id: "video-before", startTime: 0, duration: 10 }),
				buildVideoElement({ id: "video-after", startTime: 10, duration: 5 }),
			],
		});

		const updated = applyTrackRippleInsert({
			tracks,
			targetTrackId: "graphic-1",
			insertTime: mediaTime({ ticks: 10 }),
			duration: mediaTime({ ticks: 4 }),
		});

		// Only the graphic track shifts; the video (main) track stays put.
		expect(updated.overlay[0].elements.map((element) => element.startTime)).toEqual(
			[0, 14].map((ticks) => mediaTime({ ticks })),
		);
		expect(updated.main.elements.map((element) => element.startTime)).toEqual(
			[0, 10].map((ticks) => mediaTime({ ticks })),
		);
	});

	test("timeline ripple shifts later elements across track types", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({
					id: "graphic-after",
					startTime: 10,
					duration: 5,
				}),
			],
			videoElements: [
				buildVideoElement({ id: "video-before", startTime: 0, duration: 10 }),
				buildVideoElement({ id: "video-after", startTime: 10, duration: 5 }),
			],
		});

		const updated = applyTimelineRippleInsert({
			tracks,
			insertTime: mediaTime({ ticks: 10 }),
			duration: mediaTime({ ticks: 4 }),
		});

		expect(updated.main.elements.map((element) => element.startTime)).toEqual(
			[0, 14].map((ticks) => mediaTime({ ticks })),
		);
		expect(
			updated.overlay[0].elements.map((element) => element.startTime),
		).toEqual([14].map((ticks) => mediaTime({ ticks })));
	});

	test("drop target snaps near a seam and marks same-track ripple insertion", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({ id: "left", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "right", startTime: 10, duration: 10 }),
			],
		});

		const target = computeDropTarget({
			elementType: "graphic",
			mouseX: 12,
			mouseY: 1,
			tracks,
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 1,
			zoomLevel: 1,
			allowRippleInsert: true,
		});

		expect(target).toMatchObject({
			trackIndex: 0,
			isNewTrack: false,
			xPosition: 10,
			rippleInsert: true,
		});
	});

	test("media replacement target does not block ripple insertion near a seam", () => {
		const tracks = buildTracks({
			videoElements: [
				buildVideoElement({ id: "left", startTime: 0, duration: 10 }),
				buildVideoElement({ id: "right", startTime: 10, duration: 10 }),
			],
		});

		const target = computeDropTarget({
			elementType: "video",
			mouseX: 10,
			mouseY: 65,
			tracks,
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 1,
			zoomLevel: 1,
			targetElementTypes: ["video", "image", "graphic"],
			allowRippleInsert: true,
		});

		expect(target).toMatchObject({
			trackIndex: 1,
			isNewTrack: false,
			xPosition: 10,
			targetElement: null,
			rippleInsert: true,
		});
	});

	test("drop target allows a wider hover zone around seams", () => {
		const tracks = buildTracks({
			videoElements: [
				buildVideoElement({ id: "left", startTime: 0, duration: 10 }),
				buildVideoElement({ id: "right", startTime: 10, duration: 10 }),
			],
		});

		const target = computeDropTarget({
			elementType: "video",
			mouseX: 60,
			mouseY: 65,
			tracks,
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 10,
			zoomLevel: 1,
			targetElementTypes: ["video", "image", "graphic"],
			allowRippleInsert: true,
		});

		expect(target).toMatchObject({
			xPosition: 10,
			rippleInsert: true,
		});
	});

	test("graphic assets can request ripple insertion from a video seam", () => {
		const tracks = buildTracks({
			videoElements: [
				buildVideoElement({ id: "left", startTime: 0, duration: 10 }),
				buildVideoElement({ id: "right", startTime: 10, duration: 10 }),
			],
		});

		const target = computeDropTarget({
			elementType: "graphic",
			mouseX: 10,
			mouseY: 65,
			tracks,
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 1,
			zoomLevel: 1,
			allowRippleInsert: true,
		});

		expect(target).toMatchObject({
			trackIndex: 1,
			isNewTrack: false,
			xPosition: 10,
			rippleInsert: true,
		});
	});
});

describe("ripple insert detection source (internal vs cursor)", () => {
	// Seam at tick 10; the right block is wide so a grab-middle drag puts the
	// dragged element's left edge deep inside it, far from any seam edge.
	// pixelsPerSecond: 10 → the 48px seam snap window is ~5 ticks wide.
	const buildSeamTracks = () =>
		buildTracks({
			elements: [
				buildGraphicElement({ id: "left", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "right", startTime: 10, duration: 40 }),
			],
		});

	test("cursor-based config: cursor over the seam triggers ripple", () => {
		const target = computeDropTarget({
			elementType: "graphic",
			mouseX: 100, // tick 10 = the seam
			mouseY: 1,
			tracks: buildSeamTracks(),
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 10,
			zoomLevel: 1,
			allowRippleInsert: true,
		});

		expect(target).toMatchObject({ xPosition: 10, rippleInsert: true });
	});

	test("internal config (left-edge override) misses the seam the cursor is over", () => {
		const target = computeDropTarget({
			elementType: "graphic",
			mouseX: 100, // cursor still over the seam (tick 10)
			mouseY: 1,
			tracks: buildSeamTracks(),
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 10,
			zoomLevel: 1,
			// Internal drag passes the dragged element's snapped LEFT EDGE.
			// Grab-middle puts the left edge at tick 30 — 20 ticks from any seam.
			startTimeOverride: mediaTime({ ticks: 30 }),
			excludeElementId: "dragged",
			allowRippleInsert: true,
		});

		expect(target.rippleInsert).toBeUndefined();
	});

	test("internal config with cursor-based ripple detection fires at the seam", () => {
		const target = computeDropTarget({
			elementType: "graphic",
			mouseX: 100, // cursor over the seam (tick 10)
			mouseY: 1,
			tracks: buildSeamTracks(),
			playheadTime: ZERO_MEDIA_TIME,
			isExternalDrop: false,
			elementDuration: mediaTime({ ticks: 4 }),
			pixelsPerSecond: 10,
			zoomLevel: 1,
			startTimeOverride: mediaTime({ ticks: 30 }),
			excludeElementId: "dragged",
			allowRippleInsert: true,
			detectRippleFromCursor: true,
		});

		// Detection follows the cursor, but the insert still lands on the seam.
		expect(target).toMatchObject({ xPosition: 10, rippleInsert: true });
	});
});
