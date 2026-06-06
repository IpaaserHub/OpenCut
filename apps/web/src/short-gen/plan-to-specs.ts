import type { ComposePlan } from "@/short-gen/schema";

/**
 * A transcript segment with its source-video time range (seconds).
 */
export type SegmentInput = {
	index: number;
	start: number;
	end: number;
	text: string;
};

/**
 * One cut from the source video, expressed entirely in seconds. No ticks, no
 * media-asset wiring — that translation lives in the wasm adapter
 * (`specs-to-elements.ts`).
 */
export type ClipSpec = {
	sourceStartSec: number;
	sourceEndSec: number;
	timelineStartSec: number;
	durationSec: number;
	caption: string;
};

/**
 * One telop (hook / per-clip caption / CTA), expressed in timeline seconds.
 */
export type TextSpec = {
	role: "hook" | "caption" | "cta";
	text: string;
	startSec: number;
	durationSec: number;
};

export type ShortSpecs = { clips: ClipSpec[]; texts: TextSpec[] };

/** Hook / CTA telops cap their on-screen time at this many seconds. */
const ENDCAP_SECONDS = 3;

/**
 * Pure transform: turn an AI `ComposePlan` + the source transcript segments into
 * second-based clip and text specs. All the bug-prone layout decisions
 * (ordering, skipping, back-to-back cursor, endcap windows) live here so they
 * can be unit-tested without loading wasm or touching a canvas.
 *
 * - One cut clip per chosen segment, laid back-to-back in `order`. Clips whose
 *   `segmentIndex` has no segment, or whose duration is <= 0, are skipped.
 * - Telops, emitted in this fixed order so the adapter can index them
 *   sequentially: hook (front), each clip's caption over its clip, CTA (end).
 */
export function planToClipSpecs({
	plan,
	segments,
}: {
	plan: ComposePlan;
	segments: SegmentInput[];
}): ShortSpecs {
	const segmentByIndex = new Map<number, SegmentInput>();
	for (const seg of segments) {
		segmentByIndex.set(seg.index, seg);
	}

	const orderedClips = [...plan.clips].sort((a, b) => a.order - b.order);

	const clips: ClipSpec[] = [];
	let cursorSec = 0;
	for (const clip of orderedClips) {
		const seg = segmentByIndex.get(clip.segmentIndex);
		if (!seg) {
			continue;
		}
		const durationSec = Math.max(0, seg.end - seg.start);
		if (durationSec <= 0) {
			continue;
		}

		clips.push({
			sourceStartSec: seg.start,
			sourceEndSec: seg.end,
			timelineStartSec: cursorSec,
			durationSec,
			caption: clip.caption,
		});

		cursorSec += durationSec;
	}

	const totalDurSec = cursorSec;

	// Order is load-bearing: the adapter assigns each text a sequential index in
	// this exact sequence (hook, then captions in clip order, then cta).
	const texts: TextSpec[] = [];

	if (plan.hookText) {
		texts.push({
			role: "hook",
			text: plan.hookText,
			startSec: 0,
			durationSec: Math.min(ENDCAP_SECONDS, totalDurSec),
		});
	}

	for (const clip of clips) {
		if (clip.caption) {
			texts.push({
				role: "caption",
				text: clip.caption,
				startSec: clip.timelineStartSec,
				durationSec: clip.durationSec,
			});
		}
	}

	if (plan.ctaText && totalDurSec > 0) {
		// CTA is a standalone end card placed AFTER all clips (and thus after the
		// last caption), so it never overlaps a subtitle in time.
		texts.push({
			role: "cta",
			text: plan.ctaText,
			startSec: totalDurSec,
			durationSec: ENDCAP_SECONDS,
		});
	}

	return { clips, texts };
}
