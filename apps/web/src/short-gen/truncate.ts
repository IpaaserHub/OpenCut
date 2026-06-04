export const MAX_TRANSCRIPT_CHARS = 12000;

export type PromptSegment = {
	index: number;
	start: number;
	end: number;
	text: string;
};

const totalChars = (segments: PromptSegment[]): number =>
	segments.reduce((sum, s) => sum + s.text.length, 0);

/**
 * Caps the total transcript size sent to the AI by EVENLY downsampling segments.
 *
 * Long videos (e.g. a 1-hour drop-in) can produce a transcript far larger than
 * the LLM token budget. This is the safety valve: it keeps a deterministic,
 * evenly-spaced subset whose total text length stays within `maxChars`, while
 * preserving each kept segment's original `index` so start/end can still be
 * looked up later.
 *
 * Guarantees: never crashes, never infinite-loops, and never returns an empty
 * result for a non-empty input (a single oversized segment is kept as-is).
 */
export function capSegmentsForPrompt({
	segments,
	maxChars = MAX_TRANSCRIPT_CHARS,
}: {
	segments: PromptSegment[];
	maxChars?: number;
}): { segments: PromptSegment[]; droppedCount: number } {
	const len = segments.length;
	if (len === 0) {
		return { segments: [], droppedCount: 0 };
	}

	const total = totalChars(segments);
	if (total <= maxChars) {
		return { segments, droppedCount: 0 };
	}

	// Even downsampling: estimate how many average-sized segments fit, then
	// derive a stride so kept indices are 0, step, 2*step, ...
	const avgChars = total / len;
	const targetCount = Math.max(1, Math.floor(maxChars / Math.max(1, avgChars)));
	const step = Math.max(1, Math.ceil(len / targetCount));

	const kept: PromptSegment[] = [];
	for (let i = 0; i < len; i += step) {
		kept.push(segments[i]);
	}

	// Segment sizes can be uneven, so the sampled set may still exceed the cap.
	// Trim from the end until within budget, but always keep at least one.
	while (kept.length > 1 && totalChars(kept) > maxChars) {
		kept.pop();
	}

	return { segments: kept, droppedCount: len - kept.length };
}
