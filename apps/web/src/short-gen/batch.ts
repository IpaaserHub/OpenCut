/**
 * Pure, wasm-free helpers for multi-short ("量産") batch generation. Kept free
 * of `@/wasm` / `@/params` imports so it stays unit-testable under bun-test.
 */

/** How many shorts to make of each composition preset. */
export type CompositionOrder = { presetId: string; count: number }[];

/** Expand an order into a flat sequence of preset ids, preserving order. */
export function orderToSequence({
	order,
}: {
	order: CompositionOrder;
}): string[] {
	const sequence: string[] = [];
	for (const { presetId, count } of order) {
		for (let i = 0; i < Math.max(0, count); i++) {
			sequence.push(presetId);
		}
	}
	return sequence;
}

/** Total number of shorts the order asks for. */
export function totalCount({ order }: { order: CompositionOrder }): number {
	return order.reduce((sum, item) => sum + Math.max(0, item.count), 0);
}

/** The segment indexes a plan's clips reference. */
export function usedSegmentIndexes({
	clips,
}: {
	clips: { segmentIndex: number }[];
}): number[] {
	return clips.map((clip) => clip.segmentIndex);
}

/** Union the running excludes with newly-used indexes; deduped and sorted. */
export function mergeExcludes({
	excludes,
	used,
}: {
	excludes: number[];
	used: number[];
}): number[] {
	return [...new Set([...excludes, ...used])].sort((a, b) => a - b);
}
