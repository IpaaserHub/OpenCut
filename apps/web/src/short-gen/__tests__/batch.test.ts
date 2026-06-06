import { describe, expect, test } from "bun:test";
import {
	mergeExcludes,
	orderToSequence,
	totalCount,
	usedSegmentIndexes,
} from "@/short-gen/batch";

describe("orderToSequence", () => {
	test("expands a composition order into a flat preset sequence (in order)", () => {
		expect(
			orderToSequence({
				order: [
					{ presetId: "conclusion", count: 2 },
					{ presetId: "list3", count: 1 },
				],
			}),
		).toEqual(["conclusion", "conclusion", "list3"]);
	});

	test("skips presets with zero (or negative) count", () => {
		expect(
			orderToSequence({
				order: [
					{ presetId: "a", count: 0 },
					{ presetId: "b", count: 2 },
					{ presetId: "c", count: -1 },
				],
			}),
		).toEqual(["b", "b"]);
	});
});

describe("totalCount", () => {
	test("sums the requested counts", () => {
		expect(
			totalCount({
				order: [
					{ presetId: "a", count: 2 },
					{ presetId: "b", count: 3 },
				],
			}),
		).toBe(5);
	});
});

describe("usedSegmentIndexes", () => {
	test("returns the segment indexes a plan's clips reference", () => {
		expect(
			usedSegmentIndexes({
				clips: [{ segmentIndex: 3 }, { segmentIndex: 1 }, { segmentIndex: 3 }],
			}),
		).toEqual([3, 1, 3]);
	});
});

describe("mergeExcludes", () => {
	test("unions running excludes with newly-used indexes, deduped and sorted", () => {
		expect(
			mergeExcludes({ excludes: [1, 4], used: [4, 2, 2] }),
		).toEqual([1, 2, 4]);
	});

	test("from empty excludes returns the deduped used set", () => {
		expect(mergeExcludes({ excludes: [], used: [5, 5, 1] })).toEqual([1, 5]);
	});
});
