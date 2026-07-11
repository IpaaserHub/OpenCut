import { describe, expect, test } from "bun:test";
import {
	TICKS_PER_SECOND,
	floorToFrame,
	formatTimecode,
	guessTimecodeFormat,
	lastFrameTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	parseTimecode,
	roundToFrame,
	snappedSeekTime,
	ticksPerFrame,
} from "../time-math";

// Test vectors ported from rust/crates/time — the TS port must stay
// bit-identical to the wasm implementation it replaces.

const FPS_30 = { numerator: 30, denominator: 1 };

describe("media time", () => {
	test("converts between seconds and ticks", () => {
		expect(mediaTimeFromSeconds({ seconds: 1.5 })).toBe(180_000);
		expect(mediaTimeToSeconds({ time: 180_000 })).toBe(1.5);
		expect(TICKS_PER_SECOND).toBe(120_000);
	});

	test("rounds half away from zero", () => {
		expect(mediaTimeFromSeconds({ seconds: 0.5 / TICKS_PER_SECOND })).toBe(1);
		expect(mediaTimeFromSeconds({ seconds: -0.5 / TICKS_PER_SECOND })).toBe(-1);
		expect(Object.is(mediaTimeFromSeconds({ seconds: -0 }), -0)).toBe(false);
	});

	test("rejects non-finite seconds", () => {
		expect(mediaTimeFromSeconds({ seconds: Number.NaN })).toBeUndefined();
		expect(mediaTimeFromSeconds({ seconds: Infinity })).toBeUndefined();
		expect(mediaTimeFromSeconds({ seconds: -Infinity })).toBeUndefined();
	});

	test("snaps to the nearest frame", () => {
		const time = mediaTimeFromSeconds({ seconds: 1.26 })!;
		expect(roundToFrame({ time, rate: FPS_30 })).toBe(152_000);
	});

	test("floors to frame", () => {
		const perFrame = 4_000;
		expect(roundToFrame({ time: perFrame * 5 + 1, rate: FPS_30 })).toBe(
			perFrame * 5,
		);
		expect(floorToFrame({ time: perFrame * 5 + perFrame / 2, rate: FPS_30 })).toBe(
			perFrame * 5,
		);
		expect(roundToFrame({ time: perFrame * 5 + perFrame / 2, rate: FPS_30 })).toBe(
			perFrame * 6,
		);
	});

	test("negative times use euclidean frame math", () => {
		// -1 tick lies in frame -1, not frame 0.
		expect(floorToFrame({ time: -1, rate: FPS_30 })).toBe(-4_000);
	});

	test("computes last frame time and snapped seek time", () => {
		const rate = { numerator: 5, denominator: 1 };
		const duration = mediaTimeFromSeconds({ seconds: 10 })!;
		expect(lastFrameTime({ duration, rate })).toBe(
			mediaTimeFromSeconds({ seconds: 9.8 }),
		);
		expect(snappedSeekTime({ time: duration, duration, rate })).toBe(duration);
		expect(lastFrameTime({ duration: 0, rate })).toBe(0);
	});
});

describe("frame rate", () => {
	test("resolves ticks per standard frame rate", () => {
		const cases: Array<[number, number, number]> = [
			[24_000, 1_001, 5_005],
			[24, 1, 5_000],
			[25, 1, 4_800],
			[30_000, 1_001, 4_004],
			[30, 1, 4_000],
			[48, 1, 2_500],
			[50, 1, 2_400],
			[60_000, 1_001, 2_002],
			[60, 1, 2_000],
			[120, 1, 1_000],
		];
		for (const [numerator, denominator, expected] of cases) {
			expect(ticksPerFrame({ rate: { numerator, denominator } })).toBe(expected);
		}
	});

	test("rejects invalid or unsupported rates", () => {
		expect(ticksPerFrame({ rate: { numerator: 0, denominator: 1 } })).toBeUndefined();
		expect(ticksPerFrame({ rate: { numerator: 1, denominator: 0 } })).toBeUndefined();
		expect(ticksPerFrame({ rate: { numerator: 7, denominator: 3 } })).toBeUndefined();
	});
});

describe("timecode", () => {
	test("formats default and frame timecodes", () => {
		expect(
			formatTimecode({ time: mediaTimeFromSeconds({ seconds: 3723.45 })! }),
		).toBe("01:02:03:45");
		expect(
			formatTimecode({
				time: mediaTimeFromSeconds({ seconds: 1.5 })!,
				format: "HH:MM:SS:FF",
				rate: FPS_30,
			}),
		).toBe("00:00:01:15");
	});

	test("parses timecodes", () => {
		expect(parseTimecode({ timeCode: "01:05", format: "MM:SS" })).toBe(
			mediaTimeFromSeconds({ seconds: 65 }),
		);
		expect(
			parseTimecode({ timeCode: "00:00:01:15", format: "HH:MM:SS:FF", rate: FPS_30 }),
		).toBe(mediaTimeFromSeconds({ seconds: 1.5 }));
		expect(
			parseTimecode({ timeCode: "00:00:01:30", format: "HH:MM:SS:FF", rate: FPS_30 }),
		).toBeUndefined();
		expect(parseTimecode({ timeCode: "01:75", format: "MM:SS" })).toBeUndefined();
		expect(parseTimecode({ timeCode: "", format: "MM:SS" })).toBeUndefined();
		expect(parseTimecode({ timeCode: "0a:05", format: "MM:SS" })).toBeUndefined();
	});

	test("guesses timecode formats", () => {
		expect(guessTimecodeFormat({ timeCode: "01:05" })).toBe("MM:SS");
		expect(guessTimecodeFormat({ timeCode: "00:00:01" })).toBe("HH:MM:SS");
		expect(guessTimecodeFormat({ timeCode: "00:00:01:15" })).toBe("HH:MM:SS:FF");
		expect(guessTimecodeFormat({ timeCode: "abc" })).toBeUndefined();
		expect(guessTimecodeFormat({ timeCode: "" })).toBeUndefined();
	});
});
