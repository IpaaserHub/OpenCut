import { describe, expect, mock, test } from "bun:test";
import type {
	GraphicElement,
	GraphicTrack,
	SceneTracks,
	VideoElement,
	VideoTrack,
} from "@/timeline";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 1,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds),
	mediaTimeToSeconds: ({ time }: { time: number }) => time,
	roundToFrame: ({ time }: { time: number }) => time,
	snappedSeekTime: ({ time }: { time: number }) => time,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	parseTimecode: () => null,
}));

const [{ findTrackGaps, closeTrackGap }, { mediaTime, ZERO_MEDIA_TIME }] =
	await Promise.all([import("@/timeline/placement"), import("@/wasm")]);

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

	return { overlay: [graphicTrack], main: mainTrack, audio: [] };
}

describe("track gaps", () => {
	test("findTrackGaps returns the empty spans between sorted elements", () => {
		const track: GraphicTrack = {
			id: "graphic-1",
			type: "graphic",
			name: "Graphic",
			hidden: false,
			elements: [
				buildGraphicElement({ id: "a", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "b", startTime: 15, duration: 5 }),
				buildGraphicElement({ id: "c", startTime: 30, duration: 5 }),
			],
		};

		expect(findTrackGaps({ track })).toEqual([
			{ startTime: mediaTime({ ticks: 10 }), duration: mediaTime({ ticks: 5 }) },
			{
				startTime: mediaTime({ ticks: 20 }),
				duration: mediaTime({ ticks: 10 }),
			},
		]);
	});

	test("findTrackGaps ignores adjacent and overlapping elements", () => {
		const track: GraphicTrack = {
			id: "graphic-1",
			type: "graphic",
			name: "Graphic",
			hidden: false,
			elements: [
				buildGraphicElement({ id: "a", startTime: 0, duration: 10 }),
				// touches a's end — no gap
				buildGraphicElement({ id: "b", startTime: 10, duration: 5 }),
			],
		};

		expect(findTrackGaps({ track })).toEqual([]);
	});

	test("closeTrackGap collapses one gap, shifting only later elements and keeping other gaps and tracks", () => {
		const tracks = buildTracks({
			elements: [
				buildGraphicElement({ id: "a", startTime: 0, duration: 10 }),
				buildGraphicElement({ id: "b", startTime: 15, duration: 5 }),
				buildGraphicElement({ id: "c", startTime: 30, duration: 5 }),
			],
			videoElements: [
				buildVideoElement({ id: "v", startTime: 12, duration: 6 }),
			],
		});

		// Close the first gap (10 → 15, size 5).
		const updated = closeTrackGap({
			tracks,
			trackId: "graphic-1",
			gapStartTime: mediaTime({ ticks: 10 }),
			gapDuration: mediaTime({ ticks: 5 }),
		});

		// a unchanged; b and c each pulled left by 5.
		expect(
			updated.overlay[0].elements.map((element) => element.startTime),
		).toEqual([0, 10, 25]);

		// The second gap (between b-end 15 and c-start 25) still exists.
		expect(findTrackGaps({ track: updated.overlay[0] })).toEqual([
			{
				startTime: mediaTime({ ticks: 15 }),
				duration: mediaTime({ ticks: 10 }),
			},
		]);

		// The video track is untouched.
		expect(updated.main.elements.map((element) => element.startTime)).toEqual([
			12,
		]);
	});
});
