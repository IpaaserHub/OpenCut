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
 * Decode a picked media asset to the mono PCM + source descriptor needed for
 * silence cut. Expensive (demux + decode) — call once per asset, then run the
 * pure `detectSilences` repeatedly against `samples` as the user tunes options.
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
	try {
		const { samples, sampleRate } = await extractAssetMonoSamples({
			editor,
			asset,
		});
		if (samples.length === 0) {
			return { ok: false, reason: "この動画から音声を検出できませんでした" };
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
