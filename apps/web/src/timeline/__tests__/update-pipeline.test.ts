import { describe, expect, mock, test } from "bun:test";
import type { Transform } from "@/rendering";
import type { SceneTracks, VideoElement } from "@/timeline";

// Timeline tests express positions in tiny raw ticks (1 tick = 1 second), so
// stub the tick lattice instead of using the real 120000-ticks/s constants.
// Every timeline test file registers this same mock before importing "@/wasm"
// so combined runs are order-independent (bun caches modules per process).
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

const [{ applyElementUpdate }, { mediaTime, ZERO_MEDIA_TIME }] =
	await Promise.all([import("@/timeline/update-pipeline"), import("@/wasm")]);

function buildTransform(): Transform {
	return {
		scaleX: 1,
		scaleY: 1,
		position: { x: 0, y: 0 },
		rotate: 0,
	};
}

function buildVideoElement(overrides: Partial<VideoElement> = {}): VideoElement {
	return {
		id: "video-1",
		type: "video",
		name: "Video 1",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: 10 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: "media-1",
		params: {
			"transform.positionX": 0,
			"transform.positionY": 0,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		},
		...overrides,
	};
}

function buildTracks(element: VideoElement): SceneTracks {
	return {
		overlay: [],
		main: {
			id: "main-track",
			type: "video",
			name: "Main",
			muted: false,
			hidden: false,
			elements: [element],
		},
		audio: [],
	};
}

describe("applyElementUpdate", () => {
	test("rounds retimed durations back to integer media time", () => {
		const element = buildVideoElement();
		const tracks = buildTracks(element);

		const updatedElement = applyElementUpdate({
			element,
			patch: {
				retime: { rate: 1.5 },
			},
			context: {
				tracks,
				trackId: tracks.main.id,
			},
		});

		expect(updatedElement.duration).toBe(mediaTime({ ticks: 7 }));
		expect(Number.isInteger(updatedElement.duration)).toBe(true);
	});
});
