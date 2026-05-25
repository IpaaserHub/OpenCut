import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_CAPTION_LINE_CHARACTERS,
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/transcription/caption-defaults";

function normalizeLineCharacterCount({
	lineCharacterCount,
}: {
	lineCharacterCount: number | null | undefined;
}): number | null {
	if (lineCharacterCount == null || !Number.isFinite(lineCharacterCount)) {
		return null;
	}

	const normalized = Math.floor(lineCharacterCount);
	return normalized > 0 ? normalized : null;
}

export function wrapCaptionTextByCharacterCount({
	text,
	lineCharacterCount,
}: {
	text: string;
	lineCharacterCount: number | null | undefined;
}): string {
	const normalizedLineCharacterCount = normalizeLineCharacterCount({
		lineCharacterCount,
	});
	if (!normalizedLineCharacterCount) return text;

	return text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => {
			const characters = Array.from(line);
			if (characters.length <= normalizedLineCharacterCount) {
				return line;
			}

			const lines: string[] = [];
			for (
				let index = 0;
				index < characters.length;
				index += normalizedLineCharacterCount
			) {
				lines.push(
					characters
						.slice(index, index + normalizedLineCharacterCount)
						.join(""),
				);
			}
			return lines.join("\n");
		})
		.join("\n");
}

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
	lineCharacterCount = DEFAULT_CAPTION_LINE_CHARACTERS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	minDuration?: number;
	lineCharacterCount?: number | null;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments) {
		const words = segment.text.trim().split(/\s+/);
		if (words.length === 0 || (words.length === 1 && words[0] === "")) continue;

		const segmentDuration = segment.end - segment.start;
		const wordsPerSecond = words.length / segmentDuration;

		const chunks: string[] = [];
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
		}

		let chunkStartTime = segment.start;
		for (const chunk of chunks) {
			const chunkWords = chunk.split(/\s+/).length;
			const chunkDuration = Math.max(minDuration, chunkWords / wordsPerSecond);
			const adjustedStartTime = Math.max(chunkStartTime, globalEndTime);

			captions.push({
				text: wrapCaptionTextByCharacterCount({
					text: chunk,
					lineCharacterCount,
				}),
				startTime: adjustedStartTime,
				duration: chunkDuration,
			});

			globalEndTime = adjustedStartTime + chunkDuration;
			chunkStartTime += chunkDuration;
		}
	}

	return captions;
}
