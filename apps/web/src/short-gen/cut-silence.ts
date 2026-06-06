import type { EditorCore } from "@/core";
import type { MediaAsset } from "@/media/types";
import { applyShortToTimeline } from "@/short-gen/apply-plan";
import type { ShortSpecs } from "@/short-gen/plan-to-specs";
import {
	type Interval,
	keepIntervalsToClipSpecs,
} from "@/short-gen/silence-detection";
import {
	sourceVideoFromAsset,
	type SourceVideoDescriptor,
} from "@/short-gen/source-video";
import { specsToElements } from "@/short-gen/specs-to-elements";
import { extractAssetMonoSamples } from "@/transcription/run-transcription";

/**
 * Everything the UI needs to run silence cut on one picked asset: the decoded
 * mono PCM (so re-detecting on a slider change is instant and never re-decodes)
 * plus the source descriptor used to build clips. Extracting this is the only
 * expensive step.
 */
export type SilenceSource = {
	descriptor: SourceVideoDescriptor;
	samples: Float32Array;
	sampleRate: number;
};

/**
 * In-memory decoded-PCM cache, keyed by media id, so re-analyzing the same video
 * (after switching tabs / re-picking it) is instant within a session — no second
 * demux+decode. Capped to bound memory: PCM is large (~77MB per 20-min clip), so
 * unlike the tiny transcript text it is NOT persisted to disk; a full page reload
 * decodes once more.
 */
const sampleCache = new Map<string, { samples: Float32Array; sampleRate: number }>();
const MAX_CACHED_SOURCES = 3;

/** True if this asset's audio is already decoded in memory (re-analyze is instant). */
export function hasCachedSilenceSource({ mediaId }: { mediaId: string }): boolean {
	return sampleCache.has(mediaId);
}

/**
 * Decode a picked media asset to the mono PCM + source descriptor needed for
 * silence cut. Expensive (demux + decode) on a cache miss; instant on a hit.
 * Once decoded, run the pure `detectSilences` repeatedly against `samples` as the
 * user tunes options.
 */
export async function extractSilenceSource({
	editor,
	asset,
}: {
	editor: EditorCore;
	asset: MediaAsset;
}): Promise<
	{ ok: true; source: SilenceSource } | { ok: false; reason: string }
> {
	const cached = sampleCache.get(asset.id);
	if (cached) {
		return {
			ok: true,
			source: {
				descriptor: sourceVideoFromAsset({ asset }),
				samples: cached.samples,
				sampleRate: cached.sampleRate,
			},
		};
	}

	try {
		const { samples, sampleRate } = await extractAssetMonoSamples({
			editor,
			asset,
		});
		if (samples.length === 0) {
			return { ok: false, reason: "この動画から音声を検出できませんでした" };
		}
		// Cache the decoded PCM, evicting the oldest entry past the cap (Map keeps
		// insertion order, so the first key is the oldest).
		sampleCache.set(asset.id, { samples, sampleRate });
		if (sampleCache.size > MAX_CACHED_SOURCES) {
			const oldest = sampleCache.keys().next().value;
			if (oldest !== undefined) sampleCache.delete(oldest);
		}
		return {
			ok: true,
			source: {
				descriptor: sourceVideoFromAsset({ asset }),
				samples,
				sampleRate,
			},
		};
	} catch {
		return { ok: false, reason: "音声の抽出に失敗しました" };
	}
}

/**
 * Commit the kept (non-silent) ranges as a back-to-back clip sequence in a
 * dedicated new scene, leaving the original untouched (non-destructive). Reuses
 * the AI-short adapter (`specsToElements` -> `applyShortToTimeline`); the specs
 * carry clips only — silence cut burns no telops.
 */
export async function applySilenceCut({
	editor,
	descriptor,
	keep,
	sceneName = "無音カット",
}: {
	editor: EditorCore;
	descriptor: SourceVideoDescriptor;
	keep: Interval[];
	sceneName?: string;
}): Promise<{ ok: true; sceneId: string } | { ok: false; reason: string }> {
	// Decoded audio can run a hair longer than the video track; clamp keep ranges
	// to the asset's real duration so the last clip never references past the
	// video tail (which would show a frozen/black frame).
	const clamped =
		descriptor.durationSec > 0
			? keep
					.map((iv) => ({
						startSec: Math.min(iv.startSec, descriptor.durationSec),
						endSec: Math.min(iv.endSec, descriptor.durationSec),
					}))
					.filter((iv) => iv.endSec > iv.startSec)
			: keep;

	const specs: ShortSpecs = {
		clips: keepIntervalsToClipSpecs({ keep: clamped }),
		texts: [],
	};
	if (specs.clips.length === 0) {
		return { ok: false, reason: "残すクリップがありません" };
	}

	const { videoElements, textElements, ctaTextElement } = specsToElements({
		specs,
		sourceMediaId: descriptor.mediaId,
		sourceVideoParams: descriptor.params,
		sourceDurationSec: descriptor.durationSec,
		canvasSize: editor.project.getActive().settings.canvasSize,
	});

	let sceneId: string;
	try {
		sceneId = await editor.scenes.createScene({ name: sceneName, isMain: false });
		await editor.scenes.switchToScene({ sceneId });
	} catch {
		return { ok: false, reason: "無音カット用シーンの作成に失敗しました" };
	}

	applyShortToTimeline({ editor, videoElements, textElements, ctaTextElement });

	return { ok: true, sceneId };
}
