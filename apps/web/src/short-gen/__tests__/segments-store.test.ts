import { describe, expect, test } from "bun:test";
import { useTranscriptSegments } from "@/short-gen/segments-store";

describe("transcript segments store", () => {
	test("stores and reads back segments", () => {
		useTranscriptSegments.getState().setSegments([{ text: "a", start: 0, end: 1 }]);
		expect(useTranscriptSegments.getState().segments).toHaveLength(1);
	});
	test("clears segments", () => {
		useTranscriptSegments.getState().setSegments([{ text: "a", start: 0, end: 1 }]);
		useTranscriptSegments.getState().clear();
		expect(useTranscriptSegments.getState().segments).toEqual([]);
	});
});
