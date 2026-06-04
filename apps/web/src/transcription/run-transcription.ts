import type { EditorCore } from "@/core";
import { decodeAudioToFloat32 } from "@/media/audio";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useTranscriptSegments } from "@/short-gen/segments-store";
import { transcriptionService } from "@/services/transcription/service";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionResult,
} from "@/transcription/types";

/**
 * Single source of truth for the transcription pipeline: extract the timeline
 * audio, decode it to float32 samples, run the transcription service, and store
 * the resulting segments in `useTranscriptSegments`. Returns the full
 * `TranscriptionResult` so callers can build captions from `result.segments`.
 */
export async function runTranscription({
	editor,
	language,
	onProgress,
}: {
	editor: EditorCore;
	language: TranscriptionLanguage;
	onProgress?: (progress: TranscriptionProgress) => void;
}): Promise<TranscriptionResult> {
	const audioBlob = await extractTimelineAudio({
		tracks: editor.scenes.getActiveScene().tracks,
		mediaAssets: editor.media.getAssets(),
		totalDuration: editor.timeline.getTotalDuration(),
	});

	const { samples } = await decodeAudioToFloat32({
		audioBlob,
		sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
	});

	const result = await transcriptionService.transcribe({
		audioData: samples,
		language,
		onProgress,
	});

	useTranscriptSegments.getState().setSegments(result.segments);

	return result;
}
