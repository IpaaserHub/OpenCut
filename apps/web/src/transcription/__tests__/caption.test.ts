import { describe, expect, test } from "bun:test";
import {
	buildCaptionChunks,
	wrapCaptionTextByCharacterCount,
} from "@/transcription/caption";

describe("caption text wrapping", () => {
	test("wraps continuous Japanese text at the selected character count", () => {
		expect(
			wrapCaptionTextByCharacterCount({
				text: "私は田中龍都です。",
				lineCharacterCount: 3,
			}),
		).toBe("私は田\n中龍都\nです。");
	});

	test("applies character wrapping to generated caption chunks", () => {
		const chunks = buildCaptionChunks({
			segments: [{ text: "私は田中龍都です。", start: 0, end: 2 }],
			lineCharacterCount: 3,
		});

		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.text).toBe("私は田\n中龍都\nです。");
	});
});
