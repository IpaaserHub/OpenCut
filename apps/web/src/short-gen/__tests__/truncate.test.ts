import { describe, expect, test } from "bun:test";
import { capSegmentsForPrompt } from "@/short-gen/truncate";

const mk = ({ n, len }: { n: number; len: number }) =>
	Array.from({ length: n }, (_, i) => ({ index: i, start: i, end: i + 1, text: "x".repeat(len) }));

describe("capSegmentsForPrompt", () => {
	test("returns all when under cap", () => {
		const r = capSegmentsForPrompt({ segments: mk({ n: 1, len: 3 }), maxChars: 100 });
		expect(r.segments).toHaveLength(1);
		expect(r.droppedCount).toBe(0);
	});
	test("empty input is safe", () => {
		const r = capSegmentsForPrompt({ segments: [], maxChars: 100 });
		expect(r.segments).toEqual([]);
		expect(r.droppedCount).toBe(0);
	});
	test("downsamples over cap and stays within budget", () => {
		const r = capSegmentsForPrompt({ segments: mk({ n: 100, len: 10 }), maxChars: 100 });
		const total = r.segments.reduce((n, s) => n + s.text.length, 0);
		expect(total).toBeLessThanOrEqual(100);
		expect(r.droppedCount).toBeGreaterThan(0);
		expect(r.segments.length + r.droppedCount).toBe(100);
	});
	test("keeps original indices (not renumbered)", () => {
		const r = capSegmentsForPrompt({ segments: mk({ n: 100, len: 10 }), maxChars: 100 });
		// indices must be a subset of 0..99 and strictly increasing
		const idx = r.segments.map((s) => s.index);
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(Math.max(...idx)).toBeLessThanOrEqual(99);
	});
	test("single oversized segment is kept (never empty for non-empty input)", () => {
		const r = capSegmentsForPrompt({ segments: mk({ n: 1, len: 500 }), maxChars: 100 });
		expect(r.segments.length).toBe(1);
		expect(r.droppedCount).toBe(0);
	});
});
