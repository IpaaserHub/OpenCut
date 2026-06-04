import type { EditorCore } from "@/core";
import type { ParamValues } from "@/params";
import { applyShortToTimeline } from "@/short-gen/apply-plan";
import { planToClipSpecs, type SegmentInput } from "@/short-gen/plan-to-specs";
import { composePlanSchema, type ComposePlan } from "@/short-gen/schema";
import { z } from "zod";
import { useTranscriptSegments } from "@/short-gen/segments-store";
import { useShortMeta } from "@/short-gen/short-meta-store";
import { specsToElements } from "@/short-gen/specs-to-elements";
import { findSourceVideo } from "@/short-gen/source-video";
import { capSegmentsForPrompt } from "@/short-gen/truncate";

/**
 * A planner turns the (capped, indexed) transcript segments into a
 * `ComposePlan`. The mock is the default; Task 7 injects the real AI fetch via
 * this seam without touching the rest of `generateShort`.
 */
export type Planner = (input: {
	segments: SegmentInput[];
	targetSeconds: number;
	presetId: string;
}) => ComposePlan | Promise<ComposePlan>;

const planResponseSchema = z.object({ plan: composePlanSchema });
const errorSchema = z.object({ error: z.string().optional() });

/**
 * The real planner: calls the server-side `/api/short-plan` endpoint, which
 * asks Claude for a `ComposePlan`. This is the default planner for
 * `prepareShort` / `generateShort`; the mock stays injectable via `planner?`.
 */
async function fetchComposePlan({
	segments,
	targetSeconds,
	presetId,
}: {
	segments: SegmentInput[];
	targetSeconds: number;
	presetId: string;
}): Promise<ComposePlan> {
	const res = await fetch("/api/short-plan", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ presetId, targetSeconds, segments }),
	});
	if (!res.ok) {
		const errorBody = errorSchema.safeParse(await res.json().catch(() => null));
		throw new Error(
			errorBody.data?.error ??
				`ショート構成の生成に失敗しました (${res.status})`,
		);
	}
	const body = planResponseSchema.safeParse(await res.json());
	if (!body.success) {
		throw new Error("ショート構成の生成結果が不正です");
	}
	return body.data.plan;
}

type GenerateResult =
	| { ok: true; droppedCount: number; sceneId: string }
	| { ok: false; reason: string };

/**
 * The source video the AI short is cut from, as returned by `findSourceVideo`.
 * Derived from that function so it stays in sync without re-importing param
 * types.
 */
export type SourceVideo = NonNullable<ReturnType<typeof findSourceVideo>>;

export type PrepareResult =
	| {
			ok: true;
			plan: ComposePlan;
			segments: SegmentInput[];
			source: SourceVideo;
			droppedCount: number;
	  }
	| { ok: false; reason: string };

type ApplyResult =
	| { ok: true; sceneId: string }
	| { ok: false; reason: string };

/**
 * Steps 1-5 of the generate slice WITHOUT applying anything: read the
 * transcript, find the source video, index + cap the segments, ask the planner
 * for a `ComposePlan`, and validate it. Returns the validated plan plus the
 * (indexed, capped) segments and source so a caller can preview/edit before
 * applying via `applyReviewedPlan`.
 *
 * The source video is captured here, while the source scene is still active —
 * callers must not switch scenes before calling `applyReviewedPlan`.
 */
export async function prepareShort({
	editor,
	presetId,
	targetSeconds,
	planner = fetchComposePlan,
}: {
	editor: EditorCore;
	presetId: string;
	targetSeconds: number;
	planner?: Planner;
}): Promise<PrepareResult> {
	const storeSegments = useTranscriptSegments.getState().segments;
	if (storeSegments.length === 0) {
		return { ok: false, reason: "先に文字起こしを実行してください" };
	}

	const scene = editor.scenes.getActiveSceneOrNull();
	const source = scene ? findSourceVideo({ scene }) : null;
	if (!source) {
		return { ok: false, reason: "動画が見つかりません" };
	}

	// Assign each segment its index by position in the FULL store list BEFORE
	// capping, so `segmentIndex` in the plan maps back to the right segment.
	const indexedSegments: SegmentInput[] = storeSegments.map(
		(segment, index) => ({
			index,
			start: segment.start,
			end: segment.end,
			text: segment.text,
		}),
	);

	const { segments: cappedSegments, droppedCount } = capSegmentsForPrompt({
		segments: indexedSegments,
	});

	let plan: Awaited<ReturnType<Planner>>;
	try {
		plan = await planner({
			segments: cappedSegments,
			targetSeconds,
			presetId,
		});
	} catch (error) {
		// A fetch/HTTP error from the real planner becomes a structured failure
		// instead of an unhandled throw.
		const reason =
			error instanceof Error
				? error.message
				: "ショート構成の生成に失敗しました";
		return { ok: false, reason };
	}

	// Defensive: a real planner could return malformed JSON.
	const parsed = composePlanSchema.safeParse(plan);
	if (!parsed.success) {
		return { ok: false, reason: "生成結果が不正です" };
	}

	return {
		ok: true,
		plan: parsed.data,
		segments: cappedSegments,
		source,
		droppedCount,
	};
}

/**
 * Step 6 of the generate slice: translate a (possibly user-edited) plan ->
 * specs -> timeline elements, create a dedicated "AIショート" scene, switch to
 * it, and commit the elements.
 *
 * The source video must have been captured by `prepareShort` while the source
 * scene was active; media assets are project-level, so the same `sourceMediaId`
 * remains valid in the new scene.
 */
export async function applyReviewedPlan({
	editor,
	plan,
	segments,
	source,
	telopStyleParams,
}: {
	editor: EditorCore;
	plan: ComposePlan;
	segments: SegmentInput[];
	source: SourceVideo;
	telopStyleParams?: Partial<ParamValues>;
}): Promise<ApplyResult> {
	const specs = planToClipSpecs({ plan, segments });
	const { videoElements, textElements, ctaTextElement } = specsToElements({
		specs,
		sourceMediaId: source.mediaId,
		sourceVideoParams: source.params,
		canvasSize: editor.project.getActive().settings.canvasSize,
		telopStyleParams,
	});

	// Output the AI short into a dedicated new scene so it stays cleanly
	// separated from the source timeline.
	let sceneId: string;
	try {
		sceneId = await editor.scenes.createScene({
			name: "AIショート",
			isMain: false,
		});
		await editor.scenes.switchToScene({ sceneId });
	} catch {
		return { ok: false, reason: "AIショート用シーンの作成に失敗しました" };
	}

	applyShortToTimeline({ editor, videoElements, textElements, ctaTextElement });

	// The CTA is shown at the end of the video (its own centered track, above);
	// the HOOK stays metadata-only. Both are still retained as scene metadata,
	// keyed by the new scene, for a future thumbnail/title feature (`useShortMeta`).
	useShortMeta.getState().setMeta({
		sceneId,
		hookText: plan.hookText,
		ctaText: plan.ctaText,
	});

	return { ok: true, sceneId };
}

/**
 * End-to-end slice: read the transcript, find the source video, ask the planner
 * for a `ComposePlan`, then translate plan -> specs -> timeline elements and
 * commit them. Uses a mock planner until the real AI endpoint lands (Task 7).
 *
 * Now composed from `prepareShort` + `applyReviewedPlan`; the "全自動" button
 * runs the full pipeline with no manual review step. `prepareShort` fully
 * completes (capturing the source) before `applyReviewedPlan` switches scenes,
 * preserving the original capture-then-switch ordering.
 */
export async function generateShort({
	editor,
	presetId,
	targetSeconds,
	planner = fetchComposePlan,
	telopStyleParams,
}: {
	editor: EditorCore;
	presetId: string;
	targetSeconds: number;
	planner?: Planner;
	telopStyleParams?: Partial<ParamValues>;
}): Promise<GenerateResult> {
	const prepared = await prepareShort({
		editor,
		presetId,
		targetSeconds,
		planner,
	});
	if (!prepared.ok) {
		return prepared;
	}

	const applied = await applyReviewedPlan({
		editor,
		plan: prepared.plan,
		segments: prepared.segments,
		source: prepared.source,
		telopStyleParams,
	});
	if (!applied.ok) {
		return applied;
	}

	return {
		ok: true,
		droppedCount: prepared.droppedCount,
		sceneId: applied.sceneId,
	};
}
