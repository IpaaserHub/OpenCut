import type { EditorCore } from "@/core";
import { decodeAudioToFloat32 } from "@/media/audio";
import { extractTimelineAudio } from "@/media/mediabunny";
import type { MediaAsset } from "@/media/types";
import { transcriptionService } from "@/services/transcription/service";
import { useTranscriptSegments } from "@/short-gen/segments-store";
import type { SceneTracks, VideoElement } from "@/timeline";
import { toElementDurationTicks } from "@/timeline/creation";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { buildEmptyTrack } from "@/timeline/placement";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionResult,
} from "@/transcription/types";
import { generateUUID } from "@/utils/id";
import { type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";

/**
 * Shared transcription core: extract audio from the given tracks, decode it to
 * float32 samples, run the transcription service, and persist the resulting
 * segments in `useTranscriptSegments` keyed to `sourceMediaId` (or `null` for a
 * timeline transcription). Returns the full result so callers can build
 * captions from `result.segments`.
 */
async function transcribeTracks({
	tracks,
	totalDuration,
	mediaAssets,
	language,
	onProgress,
	sourceMediaId,
}: {
	tracks: SceneTracks;
	totalDuration: number;
	mediaAssets: MediaAsset[];
	language: TranscriptionLanguage;
	onProgress?: (progress: TranscriptionProgress) => void;
	sourceMediaId: string | null;
}): Promise<TranscriptionResult> {
	const audioBlob = await extractTimelineAudio({
		tracks,
		mediaAssets,
		totalDuration,
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

	useTranscriptSegments.getState().setSegments({
		segments: result.segments,
		sourceMediaId,
	});

	return result;
}

/**
 * Transcribe the audio of the active scene's timeline. Used by the subtitle
 * caption panel, which is not tied to a specific picked source asset.
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
	return transcribeTracks({
		tracks: editor.scenes.getActiveScene().tracks,
		totalDuration: editor.timeline.getTotalDuration(),
		mediaAssets: editor.media.getAssets(),
		language,
		onProgress,
		sourceMediaId: null,
	});
}

/**
 * Build a throwaway single-element `SceneTracks` for one media asset so the AI
 * short flow can transcribe a picked video directly, without placing it on (or
 * touching) the user's editing timeline.
 */
function buildSingleAssetTracks({
	asset,
	duration,
}: {
	asset: MediaAsset;
	duration: MediaTime;
}): SceneTracks {
	const created = buildElementFromMedia({
		mediaId: asset.id,
		mediaType: "video",
		name: asset.name,
		duration,
		startTime: ZERO_MEDIA_TIME,
	});
	// We asked for a video element; narrow the create-shape union accordingly.
	if (created.type !== "video") {
		throw new Error("Expected a video element for the AI short source");
	}
	const element: VideoElement = { ...created, id: generateUUID() };
	const main = buildEmptyTrack({ id: generateUUID(), type: "video" });
	return { main: { ...main, elements: [element] }, overlay: [], audio: [] };
}

/**
 * Transcribe a media-library asset the user picked in the AI short panel. The
 * resulting segments are keyed to `asset.id` so the panel can detect a stale
 * transcript when the source video changes.
 */
export async function transcribeMediaAsset({
	editor,
	asset,
	language,
	onProgress,
}: {
	editor: EditorCore;
	asset: MediaAsset;
	language: TranscriptionLanguage;
	onProgress?: (progress: TranscriptionProgress) => void;
}): Promise<TranscriptionResult> {
	const duration = toElementDurationTicks({ seconds: asset.duration });
	return transcribeTracks({
		tracks: buildSingleAssetTracks({ asset, duration }),
		totalDuration: duration,
		mediaAssets: editor.media.getAssets(),
		language,
		onProgress,
		sourceMediaId: asset.id,
	});
}
