import type { ClipSpec } from "@/short-gen/plan-to-specs";

/** A half-open time range in source seconds: [startSec, endSec). */
export type Interval = { startSec: number; endSec: number };

export type SilenceDetectionOptions = {
	/**
	 * RMS quieter than this (dBFS, 0 = full scale) counts as silence. More
	 * negative = stricter (only true silence cut); less negative = aggressive.
	 */
	thresholdDb?: number;
	/** Silences shorter than this are kept as natural pauses (seconds). */
	minSilenceSec?: number;
	/**
	 * Air left on each side of every removed silence (seconds), so speech onsets
	 * and tails are never clipped. Each silence shrinks inward by this much.
	 */
	paddingSec?: number;
	/**
	 * Keep slivers shorter than this are dropped (seconds), avoiding a flurry of
	 * micro-clips between rapid silences.
	 */
	minKeepSec?: number;
	/** RMS analysis window length (seconds). */
	frameSec?: number;
};

export type SilenceDetectionResult = {
	/** The silence ranges that will be removed (already padded). */
	silences: Interval[];
	/** The speech ranges to keep, in order, covering everything not removed. */
	keep: Interval[];
	/** Full source length in seconds. */
	totalSec: number;
};

export const DEFAULT_SILENCE_OPTIONS: Required<SilenceDetectionOptions> = {
	thresholdDb: -40,
	minSilenceSec: 0.6,
	paddingSec: 0.1,
	minKeepSec: 0.15,
	frameSec: 0.02,
};

/** Convert a dBFS threshold into a linear RMS amplitude in [0, 1]. */
function dbToLinear(db: number): number {
	return 10 ** (db / 20);
}

/**
 * Per-frame root-mean-square amplitude over fixed windows. Mirrors the
 * `computeRmsBuckets` approach in `@/media/waveform-summary` (RMS of a short
 * window) but on a flat mono `Float32Array`, so it has no Web Audio / wasm
 * dependency and is unit-testable.
 */
export function computeFrameRms({
	samples,
	sampleRate,
	frameSec,
}: {
	samples: Float32Array;
	sampleRate: number;
	frameSec: number;
}): Float32Array {
	const frameLen = Math.max(1, Math.round(sampleRate * frameSec));
	const frameCount = Math.ceil(samples.length / frameLen);
	const rms = new Float32Array(frameCount);

	for (let f = 0; f < frameCount; f++) {
		const start = f * frameLen;
		const end = Math.min(samples.length, start + frameLen);
		let sum = 0;
		for (let i = start; i < end; i++) {
			const v = samples[i];
			sum += v * v;
		}
		const n = end - start;
		rms[f] = n > 0 ? Math.sqrt(sum / n) : 0;
	}

	return rms;
}

/** Merge runs of consecutive silent frames into raw second-based intervals. */
function rawSilenceRuns({
	rms,
	thresholdLinear,
	frameLen,
	sampleRate,
	totalSec,
}: {
	rms: Float32Array;
	thresholdLinear: number;
	frameLen: number;
	sampleRate: number;
	totalSec: number;
}): Interval[] {
	const runs: Interval[] = [];
	let runStart: number | null = null;

	const frameStartSec = (frame: number) => (frame * frameLen) / sampleRate;

	for (let f = 0; f < rms.length; f++) {
		const silent = rms[f] < thresholdLinear;
		if (silent && runStart === null) {
			runStart = f;
		} else if (!silent && runStart !== null) {
			runs.push({ startSec: frameStartSec(runStart), endSec: frameStartSec(f) });
			runStart = null;
		}
	}
	if (runStart !== null) {
		// A trailing silent run extends to the true end of the audio.
		runs.push({ startSec: frameStartSec(runStart), endSec: totalSec });
	}

	return runs;
}

/** Complement of `removed` within [0, totalSec], dropping sub-`minKeepSec` slivers. */
function keepFromRemoved({
	removed,
	totalSec,
	minKeepSec,
}: {
	removed: Interval[];
	totalSec: number;
	minKeepSec: number;
}): Interval[] {
	const keep: Interval[] = [];
	let cursor = 0;
	for (const gap of removed) {
		if (gap.startSec > cursor) {
			keep.push({ startSec: cursor, endSec: gap.startSec });
		}
		cursor = Math.max(cursor, gap.endSec);
	}
	if (cursor < totalSec) {
		keep.push({ startSec: cursor, endSec: totalSec });
	}
	return keep.filter((iv) => iv.endSec - iv.startSec >= minKeepSec);
}

/**
 * Detect removable silences in mono PCM and the speech ranges to keep.
 *
 * Pure and wasm-free: takes a flat `Float32Array` (already decoded + mixed to
 * mono by `decodeAudioToFloat32`) plus its sample rate, so the algorithm is
 * fully unit-testable. The "Vrew feel" of dead-air removal comes entirely from
 * here and is independent of transcript quality.
 */
export function detectSilences({
	samples,
	sampleRate,
	options,
}: {
	samples: Float32Array;
	sampleRate: number;
	options?: SilenceDetectionOptions;
}): SilenceDetectionResult {
	const opts = { ...DEFAULT_SILENCE_OPTIONS, ...options };
	const totalSec = samples.length / sampleRate;

	if (samples.length === 0 || sampleRate <= 0) {
		return { silences: [], keep: [], totalSec: Math.max(0, totalSec) };
	}

	const frameLen = Math.max(1, Math.round(sampleRate * opts.frameSec));
	const thresholdLinear = dbToLinear(opts.thresholdDb);

	const rms = computeFrameRms({
		samples,
		sampleRate,
		frameSec: opts.frameSec,
	});

	const runs = rawSilenceRuns({
		rms,
		thresholdLinear,
		frameLen,
		sampleRate,
		totalSec,
	});

	// Keep only runs long enough to be worth cutting, then shrink each inward by
	// the padding so we never clip the speech that bookends the silence.
	const silences: Interval[] = [];
	for (const run of runs) {
		if (run.endSec - run.startSec < opts.minSilenceSec) continue;
		const startSec = run.startSec + opts.paddingSec;
		const endSec = run.endSec - opts.paddingSec;
		if (endSec - startSec <= 0) continue;
		silences.push({ startSec, endSec });
	}

	const keep = keepFromRemoved({
		removed: silences,
		totalSec,
		minKeepSec: opts.minKeepSec,
	});

	return { silences, keep, totalSec };
}

/** Stats for the "cut N silences, save M seconds" preview. */
export function summarizeSilenceCut({
	silences,
	totalSec,
}: {
	silences: Interval[];
	totalSec: number;
}): {
	originalSec: number;
	resultSec: number;
	removedSec: number;
	removedCount: number;
} {
	const removedSec = silences.reduce(
		(sum, iv) => sum + Math.max(0, iv.endSec - iv.startSec),
		0,
	);
	return {
		originalSec: totalSec,
		resultSec: Math.max(0, totalSec - removedSec),
		removedSec,
		removedCount: silences.length,
	};
}

/**
 * Turn keep intervals into back-to-back `ClipSpec`s (the same second-based
 * shape the AI short flow feeds to `specsToElements`). Captions are empty —
 * silence cut burns no telops. Each kept range becomes one clip whose source
 * window is the range and whose timeline position follows the running cursor,
 * closing the removed gaps.
 */
export function keepIntervalsToClipSpecs({
	keep,
}: {
	keep: Interval[];
}): ClipSpec[] {
	const clips: ClipSpec[] = [];
	let cursorSec = 0;
	for (const iv of keep) {
		const durationSec = Math.max(0, iv.endSec - iv.startSec);
		if (durationSec <= 0) continue;
		clips.push({
			sourceStartSec: iv.startSec,
			sourceEndSec: iv.endSec,
			timelineStartSec: cursorSec,
			durationSec,
			caption: "",
		});
		cursorSec += durationSec;
	}
	return clips;
}
