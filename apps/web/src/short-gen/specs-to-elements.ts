import type { ParamValues } from "@/params";
import { applyTelopStyle } from "@/short-gen/apply-telop-style";
import type { ShortSpecs } from "@/short-gen/plan-to-specs";
import { buildSubtitleTextElement } from "@/subtitles/build-subtitle-text-element";
import type { CreateTextElement, CreateVideoElement } from "@/timeline/types";
import { type MediaTime, mediaTime, TICKS_PER_SECOND } from "@/wasm";

/** Project fractional seconds onto the integer-tick lattice as a `MediaTime`. */
const T = (sec: number): MediaTime =>
	mediaTime({ ticks: Math.round(sec * TICKS_PER_SECOND) });

/**
 * End-CTA font size in app units. Larger than the caption default (5, see
 * `SUBTITLE_FONT_SIZE`) so the centered end CTA reads as visually distinct from
 * the bottom captions.
 */
const CTA_FONT_SIZE = 8;

/**
 * Thin wasm/canvas adapter: a dumb 1:1 mapping from second-based `ShortSpecs`
 * (produced by the pure `planToClipSpecs`) onto timeline element specs.
 *
 * The trim convention matches the renderer / split / resize code: to show
 * source seconds [S, E] of an asset at rate 1, `trimStart = T(S)`,
 * `duration = T(E - S)`, `trimEnd = T(0)`, `sourceDuration = T(E)` — keeping the
 * invariant `trimStart + duration + trimEnd == sourceDuration` exact.
 *
 * `buildSubtitleTextElement` takes caption `startTime`/`duration` in SECONDS
 * (it converts internally) and reads a canvas via `document.createElement`, so
 * this module must only run in the browser. No unit test — verified in-app at
 * the Task 6 demo.
 */
export function specsToElements({
	specs,
	sourceMediaId,
	sourceVideoParams,
	sourceDurationSec,
	canvasSize,
	telopStyleParams,
}: {
	specs: ShortSpecs;
	sourceMediaId: string;
	sourceVideoParams: ParamValues;
	/** Full source length in seconds; lets generated clips be extended back toward it. */
	sourceDurationSec?: number;
	canvasSize: { width: number; height: number };
	telopStyleParams?: Partial<ParamValues>;
}): {
	videoElements: CreateVideoElement[];
	textElements: CreateTextElement[];
	ctaTextElement: CreateTextElement | null;
} {
	// Use the FULL source length as `sourceDuration` (not the clip end) so each
	// generated clip keeps headroom to be EXTENDED (drag the edge) toward the
	// source — and shortened. Falls back to the clip end when the length is
	// unknown. Invariant kept exact: trimStart + duration + trimEnd == sourceDuration.
	const fullSourceTicks =
		sourceDurationSec && sourceDurationSec > 0
			? Math.round(sourceDurationSec * TICKS_PER_SECOND)
			: 0;
	const videoElements: CreateVideoElement[] = specs.clips.map((clip, i) => {
		const trimStartTicks = Math.round(clip.sourceStartSec * TICKS_PER_SECOND);
		const durationTicks = Math.round(clip.durationSec * TICKS_PER_SECOND);
		const clipEndTicks = Math.round(clip.sourceEndSec * TICKS_PER_SECOND);
		const sourceTicks =
			fullSourceTicks > clipEndTicks ? fullSourceTicks : clipEndTicks;
		const trimEndTicks = Math.max(
			0,
			sourceTicks - trimStartTicks - durationTicks,
		);
		return {
			type: "video",
			mediaId: sourceMediaId,
			name: `AIショート ${i + 1}`,
			startTime: T(clip.timelineStartSec),
			duration: mediaTime({ ticks: durationTicks }),
			trimStart: mediaTime({ ticks: trimStartTicks }),
			trimEnd: mediaTime({ ticks: trimEndTicks }),
			sourceDuration: mediaTime({ ticks: sourceTicks }),
			params: sourceVideoParams,
		};
	});

	// Only per-clip captions are burned onto the timeline. Hook/CTA TextSpecs are
	// intentionally excluded here: they share screen position and time windows
	// with the first/last captions (overlap), and are instead retained as
	// scene metadata (see `useShortMeta` in `applyReviewedPlan`) for a future
	// thumbnail/title feature. Filter BEFORE mapping so caption indices (used for
	// the element `name`) re-sequence from 0.
	const textElements: CreateTextElement[] = specs.texts
		.filter((text) => text.role === "caption")
		.map((text, i) =>
			buildSubtitleTextElement({
				index: i,
				caption: {
					text: text.text,
					startTime: text.startSec,
					duration: text.durationSec,
				},
				canvasSize,
			}),
		);

	const styledTextElements = applyTelopStyle({
		elements: textElements,
		styleParams: telopStyleParams ?? {},
	});

	// The CTA is shown at the END of the short as a distinct end telop on its own
	// track. It is built independently of the per-clip captions: placed at the
	// vertical CENTER with a larger font so it never collides with the bottom
	// captions, and it deliberately skips `applyTelopStyle` (the caption template)
	// so it keeps its own look. The hook stays metadata-only (not built here).
	const ctaSpec = specs.texts.find((text) => text.role === "cta");
	const ctaTextElement: CreateTextElement | null = ctaSpec?.text.trim()
		? {
				...buildSubtitleTextElement({
					index: 0,
					caption: {
						text: ctaSpec.text,
						startTime: ctaSpec.startSec,
						duration: ctaSpec.durationSec,
						// Center vertically (distinct from bottom captions) and bump the
						// font size so it reads as a stand-alone end CTA.
						style: {
							fontSize: CTA_FONT_SIZE,
							placement: { verticalAlign: "middle" },
						},
					},
					canvasSize,
				}),
				name: "CTA",
			}
		: null;

	return { videoElements, textElements: styledTextElements, ctaTextElement };
}
