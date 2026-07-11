import { describe, expect, mock, test } from "bun:test";
import type { SceneTracks, VideoElement, VideoTrack } from "@/timeline";

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

const [{ buildMoveGroup, resolveGroupMove }, { mediaTime, ZERO_MEDIA_TIME }] =
	await Promise.all([import("@/timeline/group-move"), import("@/wasm")]);

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

function buildVideoTrack({
	id,
	elements = [],
}: {
	id: string;
	elements?: VideoElement[];
}): VideoTrack {
	return {
		id,
		type: "video",
		name: id,
		muted: false,
		hidden: false,
		elements,
	};
}

function buildSceneTracks({
	overlay = [],
	main = buildVideoTrack({ id: "main-track" }),
}: {
	overlay?: VideoTrack[];
	main?: VideoTrack;
}): SceneTracks {
	return {
		overlay,
		main,
		audio: [],
	};
}

describe("resolveGroupMove", () => {
	test("moves multiple selected elements on the same track as one block", () => {
		const tracks = buildSceneTracks({
			overlay: [
				buildVideoTrack({
					id: "video-1",
					elements: [
						buildVideoElement({ id: "a", startTime: 10, duration: 5 }),
						buildVideoElement({ id: "b", startTime: 20, duration: 5 }),
					],
				}),
			],
		});
		const group = buildMoveGroup({
			anchorRef: { trackId: "video-1", elementId: "a" },
			selectedElements: [
				{ trackId: "video-1", elementId: "a" },
				{ trackId: "video-1", elementId: "b" },
			],
			tracks,
		});
		if (!group) throw new Error("Expected move group");

		expect(
			resolveGroupMove({
				group,
				tracks,
				anchorStartTime: mediaTime({ ticks: 30 }),
				target: {
					kind: "existingTrack",
					anchorTargetTrackId: "video-1",
				},
			}),
		).toEqual({
			moves: [
				{
					sourceTrackId: "video-1",
					targetTrackId: "video-1",
					elementId: "a",
					newStartTime: mediaTime({ ticks: 30 }),
				},
				{
					sourceTrackId: "video-1",
					targetTrackId: "video-1",
					elementId: "b",
					newStartTime: mediaTime({ ticks: 40 }),
				},
			],
			createTracks: [],
			targetSelection: [
				{ trackId: "video-1", elementId: "a" },
				{ trackId: "video-1", elementId: "b" },
			],
		});
	});

	test("creates one target track per source track, not per selected element", () => {
		const tracks = buildSceneTracks({
			overlay: [
				buildVideoTrack({
					id: "video-1",
					elements: [
						buildVideoElement({ id: "a", startTime: 10, duration: 5 }),
						buildVideoElement({ id: "b", startTime: 20, duration: 5 }),
					],
				}),
			],
		});
		const group = buildMoveGroup({
			anchorRef: { trackId: "video-1", elementId: "a" },
			selectedElements: [
				{ trackId: "video-1", elementId: "a" },
				{ trackId: "video-1", elementId: "b" },
			],
			tracks,
		});
		if (!group) throw new Error("Expected move group");

		expect(
			resolveGroupMove({
				group,
				tracks,
				anchorStartTime: mediaTime({ ticks: 30 }),
				target: {
					kind: "newTracks",
					anchorInsertIndex: 0,
					newTrackIds: ["new-video-1", "new-video-2"],
				},
			}),
		).toEqual({
			moves: [
				{
					sourceTrackId: "video-1",
					targetTrackId: "new-video-1",
					elementId: "a",
					newStartTime: mediaTime({ ticks: 30 }),
				},
				{
					sourceTrackId: "video-1",
					targetTrackId: "new-video-1",
					elementId: "b",
					newStartTime: mediaTime({ ticks: 40 }),
				},
			],
			createTracks: [
				{
					id: "new-video-1",
					type: "video",
					index: 0,
				},
			],
			targetSelection: [
				{ trackId: "new-video-1", elementId: "a" },
				{ trackId: "new-video-1", elementId: "b" },
			],
		});
	});

	test("can ignore target collisions for ripple insert moves", () => {
		const tracks = buildSceneTracks({
			overlay: [
				buildVideoTrack({
					id: "video-1",
					elements: [
						buildVideoElement({ id: "a", startTime: 0, duration: 10 }),
						buildVideoElement({ id: "b", startTime: 10, duration: 10 }),
					],
				}),
			],
		});
		const group = buildMoveGroup({
			anchorRef: { trackId: "video-1", elementId: "a" },
			selectedElements: [{ trackId: "video-1", elementId: "a" }],
			tracks,
		});
		if (!group) throw new Error("Expected move group");

		const blockedMove = resolveGroupMove({
			group,
			tracks,
			anchorStartTime: mediaTime({ ticks: 10 }),
			target: {
				kind: "existingTrack",
				anchorTargetTrackId: "video-1",
			},
		});
		const rippleMove = resolveGroupMove({
			group,
			tracks,
			anchorStartTime: mediaTime({ ticks: 10 }),
			target: {
				kind: "existingTrack",
				anchorTargetTrackId: "video-1",
				ignoreTargetCollisions: true,
			},
		});

		expect(blockedMove).toBeNull();
		expect(rippleMove?.moves).toEqual([
			{
				sourceTrackId: "video-1",
				targetTrackId: "video-1",
				elementId: "a",
				newStartTime: mediaTime({ ticks: 10 }),
			},
		]);
	});
});
