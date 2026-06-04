import type { ComposePlan } from "@/short-gen/schema";
import type { SegmentInput } from "@/short-gen/plan-to-specs";

const HOOK_TEXT = "知らないと損する話";
const CTA_TEXT = "保存して後で見返してね";
const CAPTION_MAX_CHARS = 24;

const truncateCaption = ({ text }: { text: string }): string => {
	const trimmed = text.trim();
	return trimmed.length > CAPTION_MAX_CHARS
		? `${trimmed.slice(0, CAPTION_MAX_CHARS)}…`
		: trimmed;
};

/**
 * Deterministic stand-in for the real AI planner (Task 7).
 *
 * Picks a spread of segments (first / middle / last) from the supplied list,
 * accumulating their durations until `targetSeconds` is reached, and emits a
 * `ComposePlan` whose clip `segmentIndex` values reference exactly those
 * segments. Because the indices come straight from the segments handed in (the
 * capped, indexed list), every clip is guaranteed to resolve in
 * `planToClipSpecs`. Hook / CTA / captions are fixed Japanese strings.
 */
export function mockComposePlan({
	segments,
	targetSeconds,
}: {
	segments: SegmentInput[];
	targetSeconds: number;
}): ComposePlan {
	const candidates =
		segments.length <= 3
			? segments
			: [
					segments[0],
					segments[Math.floor(segments.length / 2)],
					segments[segments.length - 1],
				];

	const clips: ComposePlan["clips"] = [];
	let accumulatedSeconds = 0;
	for (const segment of candidates) {
		if (clips.length > 0 && accumulatedSeconds >= targetSeconds) {
			break;
		}
		clips.push({
			segmentIndex: segment.index,
			order: clips.length,
			caption: truncateCaption({ text: segment.text }),
		});
		accumulatedSeconds += Math.max(0, segment.end - segment.start);
	}

	return {
		hookText: HOOK_TEXT,
		clips,
		ctaText: CTA_TEXT,
		estimatedSeconds: accumulatedSeconds,
	};
}
