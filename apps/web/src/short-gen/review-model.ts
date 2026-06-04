import type { ComposePlan } from "@/short-gen/schema";

/**
 * One clip in the manual-review UI, in display order. `adopted` toggles whether
 * the clip is kept when the review is converted back into a `ComposePlan`.
 */
export type EditableClip = {
	segmentIndex: number;
	caption: string;
	adopted: boolean;
};

/**
 * The mutable, user-facing shape of a plan during manual review: hook + CTA
 * text plus an ordered, individually-toggleable list of clips.
 */
export type EditableReview = {
	hookText: string;
	ctaText: string;
	clips: EditableClip[];
};

/**
 * Convert a validated `ComposePlan` into an `EditableReview` for the review UI.
 * Clips are sorted by their `order` field into display order, and every clip is
 * marked `adopted: true`. Pure: no editor, wasm, or React.
 */
export function editableFromPlan({
	plan,
}: {
	plan: ComposePlan;
}): EditableReview {
	const clips = [...plan.clips]
		.sort((a, b) => a.order - b.order)
		.map((clip) => ({
			segmentIndex: clip.segmentIndex,
			caption: clip.caption,
			adopted: true,
		}));

	return {
		hookText: plan.hookText,
		ctaText: plan.ctaText,
		clips,
	};
}

/**
 * Convert an `EditableReview` back into a `ComposePlan`, keeping only adopted
 * clips in their current array order and reassigning `order` = 0,1,2,…
 * sequentially. `estimatedSeconds` is set to 0 — the real duration is recomputed
 * by `planToClipSpecs` at apply time. Pure: operates only on the review object.
 *
 * If zero clips are adopted this returns `clips: []`, which is an INVALID plan
 * (it fails `composePlanSchema`'s `.min(1)`). The caller must guard against an
 * empty adopted set before applying.
 */
export function composePlanFromEditable({
	review,
}: {
	review: EditableReview;
}): ComposePlan {
	const clips = review.clips
		.filter((clip) => clip.adopted)
		.map((clip, index) => ({
			segmentIndex: clip.segmentIndex,
			order: index,
			caption: clip.caption,
		}));

	return {
		hookText: review.hookText,
		ctaText: review.ctaText,
		clips,
		estimatedSeconds: 0,
	};
}
