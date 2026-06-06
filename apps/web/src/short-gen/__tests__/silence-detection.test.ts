import { describe, expect, test } from "bun:test";
import {
	detectSilences,
	keepIntervalsToClipSpecs,
	summarizeSilenceCut,
	type Interval,
} from "@/short-gen/silence-detection";

/**
 * Build a mono Float32Array from [amplitude, durationSec] segments at a given
 * sample rate. Loud segments use a constant absolute amplitude (so RMS == amp);
 * silent segments are exact zeros.
 */
function makeSamples({
	sampleRate,
	segments,
}: {
	sampleRate: number;
	segments: { amp: number; durSec: number }[];
}): Float32Array {
	const total = segments.reduce(
		(n, s) => n + Math.round(s.durSec * sampleRate),
		0,
	);
	const out = new Float32Array(total);
	let i = 0;
	for (const { amp, durSec } of segments) {
		const len = Math.round(durSec * sampleRate);
		for (let j = 0; j < len; j++) out[i + j] = amp;
		i += len;
	}
	return out;
}

/** Round interval seconds so floating-point math compares cleanly. */
function r4(intervals: Interval[]): Interval[] {
	const round = (n: number) => Math.round(n * 1e4) / 1e4;
	return intervals.map((iv) => ({
		startSec: round(iv.startSec),
		endSec: round(iv.endSec),
	}));
}

describe("detectSilences", () => {
	test("removes a long silence between two loud regions", () => {
		// 1s loud, 2s silent, 1s loud at sr=1000, 10-sample (0.01s) frames.
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [
				{ amp: 0.5, durSec: 1 },
				{ amp: 0, durSec: 2 },
				{ amp: 0.5, durSec: 1 },
			],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: {
				thresholdDb: -40,
				minSilenceSec: 0.5,
				paddingSec: 0,
				minKeepSec: 0,
				frameSec: 0.01,
			},
		});

		expect(result.totalSec).toBeCloseTo(4, 5);
		expect(r4(result.silences)).toEqual([{ startSec: 1, endSec: 3 }]);
		expect(r4(result.keep)).toEqual([
			{ startSec: 0, endSec: 1 },
			{ startSec: 3, endSec: 4 },
		]);
	});

	test("keeps short pauses shorter than minSilenceSec", () => {
		// 1s loud, 0.3s silent, 1s loud — pause < 0.5s threshold, so nothing cut.
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [
				{ amp: 0.5, durSec: 1 },
				{ amp: 0, durSec: 0.3 },
				{ amp: 0.5, durSec: 1 },
			],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: {
				thresholdDb: -40,
				minSilenceSec: 0.5,
				paddingSec: 0,
				minKeepSec: 0,
				frameSec: 0.01,
			},
		});

		expect(result.silences).toEqual([]);
		expect(r4(result.keep)).toEqual([{ startSec: 0, endSec: 2.3 }]);
	});

	test("leaves padding (air) on each side of a removed silence", () => {
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [
				{ amp: 0.5, durSec: 1 },
				{ amp: 0, durSec: 2 },
				{ amp: 0.5, durSec: 1 },
			],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: {
				thresholdDb: -40,
				minSilenceSec: 0.5,
				paddingSec: 0.1,
				minKeepSec: 0,
				frameSec: 0.01,
			},
		});

		// The removed silence shrinks inward by 0.1s on each side.
		expect(r4(result.silences)).toEqual([{ startSec: 1.1, endSec: 2.9 }]);
		expect(r4(result.keep)).toEqual([
			{ startSec: 0, endSec: 1.1 },
			{ startSec: 2.9, endSec: 4 },
		]);
	});

	test("returns one keep interval covering everything when never silent", () => {
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [{ amp: 0.5, durSec: 2 }],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: { thresholdDb: -40, minSilenceSec: 0.5, frameSec: 0.01 },
		});

		expect(result.silences).toEqual([]);
		expect(r4(result.keep)).toEqual([{ startSec: 0, endSec: 2 }]);
	});

	test("returns no keep intervals when entirely silent", () => {
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [{ amp: 0, durSec: 2 }],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: {
				thresholdDb: -40,
				minSilenceSec: 0.5,
				paddingSec: 0,
				frameSec: 0.01,
			},
		});

		expect(r4(result.silences)).toEqual([{ startSec: 0, endSec: 2 }]);
		expect(result.keep).toEqual([]);
	});

	test("drops keep slivers shorter than minKeepSec", () => {
		// loud 0.1s, silent 0.6s, loud 0.1s, silent 0.6s, loud 1s.
		// The two 0.1s loud slivers are below minKeepSec=0.2 and get dropped.
		const samples = makeSamples({
			sampleRate: 1000,
			segments: [
				{ amp: 0.5, durSec: 0.1 },
				{ amp: 0, durSec: 0.6 },
				{ amp: 0.5, durSec: 0.1 },
				{ amp: 0, durSec: 0.6 },
				{ amp: 0.5, durSec: 1 },
			],
		});

		const result = detectSilences({
			samples,
			sampleRate: 1000,
			options: {
				thresholdDb: -40,
				minSilenceSec: 0.5,
				paddingSec: 0,
				minKeepSec: 0.2,
				frameSec: 0.01,
			},
		});

		// Only the final 1s loud region survives as a keep interval.
		expect(r4(result.keep)).toEqual([{ startSec: 1.4, endSec: 2.4 }]);
	});

	test("empty audio yields no silences and no keep intervals", () => {
		const result = detectSilences({
			samples: new Float32Array(0),
			sampleRate: 1000,
		});
		expect(result.totalSec).toBe(0);
		expect(result.silences).toEqual([]);
		expect(result.keep).toEqual([]);
	});
});

describe("summarizeSilenceCut", () => {
	test("computes removed time, count, and resulting length", () => {
		const summary = summarizeSilenceCut({
			silences: [
				{ startSec: 1, endSec: 3 },
				{ startSec: 5, endSec: 5.5 },
			],
			totalSec: 10,
		});
		expect(summary.originalSec).toBeCloseTo(10, 5);
		expect(summary.removedSec).toBeCloseTo(2.5, 5);
		expect(summary.resultSec).toBeCloseTo(7.5, 5);
		expect(summary.removedCount).toBe(2);
	});

	test("nothing removed when there are no silences", () => {
		const summary = summarizeSilenceCut({ silences: [], totalSec: 4 });
		expect(summary.removedSec).toBe(0);
		expect(summary.resultSec).toBeCloseTo(4, 5);
		expect(summary.removedCount).toBe(0);
	});
});

describe("keepIntervalsToClipSpecs", () => {
	test("lays keep intervals back-to-back on the timeline with empty captions", () => {
		const clips = keepIntervalsToClipSpecs({
			keep: [
				{ startSec: 0, endSec: 1 },
				{ startSec: 3, endSec: 4.5 },
			],
		});
		expect(clips).toEqual([
			{
				sourceStartSec: 0,
				sourceEndSec: 1,
				timelineStartSec: 0,
				durationSec: 1,
				caption: "",
			},
			{
				sourceStartSec: 3,
				sourceEndSec: 4.5,
				timelineStartSec: 1,
				durationSec: 1.5,
				caption: "",
			},
		]);
	});

	test("returns no clips for empty keep intervals", () => {
		expect(keepIntervalsToClipSpecs({ keep: [] })).toEqual([]);
	});
});
