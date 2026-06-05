import { beforeEach, describe, expect, test } from "bun:test";
import { useTranscriptSegments } from "@/short-gen/segments-store";

describe("transcript segments store", () => {
	beforeEach(() => {
		useTranscriptSegments.getState().clear();
	});

	test("stores and reads back segments", () => {
		useTranscriptSegments.getState().setSegments({
			segments: [{ text: "a", start: 0, end: 1 }],
			sourceMediaId: "media-1",
		});
		expect(useTranscriptSegments.getState().segments).toHaveLength(1);
	});

	test("keys the segments to the source media they were transcribed from", () => {
		useTranscriptSegments.getState().setSegments({
			segments: [{ text: "a", start: 0, end: 1 }],
			sourceMediaId: "media-42",
		});
		expect(useTranscriptSegments.getState().sourceMediaId).toBe("media-42");
	});

	test("clears both segments and sourceMediaId", () => {
		useTranscriptSegments.getState().setSegments({
			segments: [{ text: "a", start: 0, end: 1 }],
			sourceMediaId: "media-1",
		});
		useTranscriptSegments.getState().clear();
		expect(useTranscriptSegments.getState().segments).toEqual([]);
		expect(useTranscriptSegments.getState().sourceMediaId).toBeNull();
	});

	test("a timeline transcription (no specific asset) keys to null", () => {
		useTranscriptSegments.getState().setSegments({
			segments: [{ text: "a", start: 0, end: 1 }],
			sourceMediaId: null,
		});
		expect(useTranscriptSegments.getState().sourceMediaId).toBeNull();
	});
});
