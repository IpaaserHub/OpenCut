"use client";

import { useState } from "react";
import Image from "next/image";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import { AiShortReviewDialog } from "@/short-gen/components/ai-short-review-dialog";
import {
	generateShort,
	prepareShort,
	type SourceVideo,
} from "@/short-gen/generate";
import { PRESETS } from "@/short-gen/presets";
import type { SegmentInput } from "@/short-gen/plan-to-specs";
import type { ComposePlan } from "@/short-gen/schema";
import { useTranscriptSegments } from "@/short-gen/segments-store";
import { sourceVideoFromAsset } from "@/short-gen/source-video";
import type { MediaAsset } from "@/media/types";
import { useTextTemplates } from "@/text/templates-store";
import { transcribeMediaAsset } from "@/transcription/run-transcription";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/transcription/types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/utils/ui";

const LENGTH_PRESETS = [15, 30, 60] as const;
/** Sentinel for the "no template" option — Radix forbids an empty-string item value. */
const DEFAULT_TELOP_STYLE_ID = "__default__";
const MIN_TARGET_SECONDS = 5;
const MAX_TARGET_SECONDS = 180;
const TARGET_SECONDS_STEP = 5;
const DEFAULT_TARGET_SECONDS = 30;

function clampTargetSeconds({ value }: { value: number }): number {
	return Math.min(MAX_TARGET_SECONDS, Math.max(MIN_TARGET_SECONDS, value));
}

/** Format a duration in seconds as M:SS for the source picker. */
function formatDuration({ seconds }: { seconds: number | undefined }): string {
	if (!seconds || !Number.isFinite(seconds)) return "--:--";
	const total = Math.round(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

type Status =
	| { kind: "idle" }
	| { kind: "running"; message: string }
	| { kind: "success"; message: string | null }
	| { kind: "error"; message: string };

export function AiShortView() {
	const editor = useEditor();
	const templates = useTextTemplates();
	// Video assets from the media library, subscribed via the editor store so the
	// picker updates as the user imports/removes media.
	const videoAssets = useEditor((e) =>
		e.media.getAssets().filter((asset) => asset.type === "video"),
	);
	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
	const [presetId, setPresetId] = useState<string>(PRESETS[0].id);
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
		DEFAULT_TELOP_STYLE_ID,
	);
	const [language, setLanguage] = useState<TranscriptionLanguage>("ja");
	const [targetSeconds, setTargetSeconds] = useState<number>(
		DEFAULT_TARGET_SECONDS,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	const [reviewState, setReviewState] = useState<{
		plan: ComposePlan;
		segments: SegmentInput[];
		source: SourceVideo;
	} | null>(null);
	const [isReviewOpen, setIsReviewOpen] = useState(false);

	const selectedAsset =
		videoAssets.find((asset) => asset.id === selectedSourceId) ?? null;
	// A source with no audio track can't be transcribed, so it can't drive a short.
	const canGenerate = selectedAsset !== null && selectedAsset.hasAudio !== false;

	const telopStyleParams =
		selectedTemplateId === DEFAULT_TELOP_STYLE_ID
			? undefined
			: templates.find((template) => template.id === selectedTemplateId)
					?.params;

	const handleLanguageChange = ({ value }: { value: string }) => {
		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(item) => item.code === value,
		);
		if (!matchedLanguage) return;
		setLanguage(matchedLanguage.code);
	};

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			setStatus({
				kind: "running",
				message: `モデルを読み込み中 ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			setStatus({ kind: "running", message: "文字起こし中..." });
		}
	};

	/**
	 * Run transcription if the store is empty. Shared first step of both the
	 * auto and review flows.
	 */
	const ensureTranscript = async ({ asset }: { asset: MediaAsset }) => {
		// Re-transcribe when the picked source video changes — the cached
		// transcript belongs to a different (or no) asset.
		const store = useTranscriptSegments.getState();
		if (store.sourceMediaId !== asset.id || store.segments.length === 0) {
			setStatus({ kind: "running", message: "文字起こし中..." });
			await transcribeMediaAsset({
				editor,
				asset,
				language,
				onProgress: handleProgress,
			});
		}
	};

	const handleGenerateAuto = async () => {
		if (isGenerating || !selectedAsset) return;
		setIsGenerating(true);
		try {
			await ensureTranscript({ asset: selectedAsset });

			setStatus({ kind: "running", message: "ショートを生成中..." });
			const result = await generateShort({
				editor,
				presetId,
				targetSeconds,
				telopStyleParams,
				source: sourceVideoFromAsset({ asset: selectedAsset }),
			});

			if (result.ok) {
				setStatus({
					kind: "success",
					message:
						result.droppedCount > 0
							? `長尺のため一部を要約対象から除外しました（${result.droppedCount}件）`
							: null,
				});
			} else {
				setStatus({ kind: "error", message: result.reason });
			}
		} catch (error) {
			console.error("AI short generation failed:", error);
			setStatus({
				kind: "error",
				message:
					error instanceof Error
						? error.message
						: "予期しないエラーが発生しました",
			});
		} finally {
			setIsGenerating(false);
		}
	};

	const handleGenerateReview = async () => {
		if (isGenerating || !selectedAsset) return;
		setIsGenerating(true);
		try {
			await ensureTranscript({ asset: selectedAsset });

			setStatus({ kind: "running", message: "ショートを生成中..." });
			const prepared = await prepareShort({
				editor,
				presetId,
				targetSeconds,
				source: sourceVideoFromAsset({ asset: selectedAsset }),
			});

			if (prepared.ok) {
				setReviewState({
					plan: prepared.plan,
					segments: prepared.segments,
					source: prepared.source,
				});
				setIsReviewOpen(true);
				// Nothing has been applied yet — the dialog handles that. Only surface
				// the dropped-count note (which is true after prepare); otherwise stay
				// idle so the panel doesn't claim a short was generated.
				setStatus(
					prepared.droppedCount > 0
						? {
								kind: "success",
								message: `長尺のため一部を要約対象から除外しました（${prepared.droppedCount}件）`,
							}
						: { kind: "idle" },
				);
			} else {
				setStatus({ kind: "error", message: prepared.reason });
			}
		} catch (error) {
			console.error("AI short preparation failed:", error);
			setStatus({
				kind: "error",
				message:
					error instanceof Error
						? error.message
						: "予期しないエラーが発生しました",
			});
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<PanelView title="AIショート" contentClassName="flex flex-col gap-5 pb-4">
			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">ソース動画</span>
				{videoAssets.length === 0 ? (
					<p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
						まずメディアに動画を追加してください。
					</p>
				) : (
					<div className="flex flex-col gap-1.5">
						{videoAssets.map((asset) => {
							const isSelected = asset.id === selectedSourceId;
							return (
								<button
									key={asset.id}
									type="button"
									disabled={isGenerating}
									onClick={() => setSelectedSourceId(asset.id)}
									className={cn(
										"flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
										isSelected
											? "border-primary bg-primary/10"
											: "border-border bg-accent hover:border-primary/50",
									)}
								>
									<div className="relative h-9 w-16 shrink-0 overflow-hidden rounded">
										{asset.thumbnailUrl ? (
											<Image
												src={asset.thumbnailUrl}
												alt=""
												fill
												sizes="64px"
												className="object-cover"
												unoptimized
											/>
										) : (
											<div className="bg-muted size-full" />
										)}
									</div>
									<div className="flex min-w-0 flex-col">
										<span className="truncate text-sm">{asset.name}</span>
										<span className="text-muted-foreground text-xs">
											{formatDuration({ seconds: asset.duration })}
											{asset.hasAudio === false ? " ・音声なし" : ""}
										</span>
									</div>
								</button>
							);
						})}
					</div>
				)}
				{selectedAsset?.hasAudio === false && (
					<p className="text-destructive text-xs">
						この動画は音声が無いため文字起こしできません。
					</p>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">構成プリセット</span>
				<div className="flex flex-col gap-1.5">
					{PRESETS.map((preset) => {
						const isSelected = preset.id === presetId;
						return (
							<button
								key={preset.id}
								type="button"
								disabled={isGenerating}
								onClick={() => setPresetId(preset.id)}
								className={cn(
									"flex flex-col gap-0.5 rounded-md border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
									isSelected
										? "border-primary bg-primary/10"
										: "border-border bg-accent hover:border-primary/50",
								)}
							>
								<span className="text-sm font-medium">{preset.label}</span>
								<span className="text-muted-foreground text-xs">
									{preset.description}
								</span>
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">音声の言語</span>
				<Select
					value={language}
					onValueChange={(value) => handleLanguageChange({ value })}
					disabled={isGenerating}
				>
					<SelectTrigger>
						<SelectValue placeholder="言語を選択" />
					</SelectTrigger>
					<SelectContent>
						{TRANSCRIPTION_LANGUAGES.map((item) => (
							<SelectItem key={item.code} value={item.code}>
								{item.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">長さ</span>
				<div className="flex items-center gap-2">
					{LENGTH_PRESETS.map((seconds) => (
						<Button
							key={seconds}
							type="button"
							size="sm"
							variant={targetSeconds === seconds ? "default" : "outline"}
							disabled={isGenerating}
							className="flex-1"
							onClick={() => setTargetSeconds(seconds)}
						>
							{seconds}秒
						</Button>
					))}
				</div>
				<div className="border-border bg-accent flex h-8 w-full items-center overflow-hidden rounded-md border">
					<button
						type="button"
						aria-label="長さを減らす"
						disabled={isGenerating || targetSeconds <= MIN_TARGET_SECONDS}
						className="hover:bg-background/70 text-muted-foreground flex h-full w-8 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() =>
							setTargetSeconds((current) =>
								clampTargetSeconds({ value: current - TARGET_SECONDS_STEP }),
							)
						}
					>
						−
					</button>
					<span className="flex-1 text-center text-sm tabular-nums">
						{targetSeconds}秒
					</span>
					<button
						type="button"
						aria-label="長さを増やす"
						disabled={isGenerating || targetSeconds >= MAX_TARGET_SECONDS}
						className="hover:bg-background/70 text-muted-foreground border-border flex h-full w-8 shrink-0 items-center justify-center border-l disabled:cursor-not-allowed disabled:opacity-40"
						onClick={() =>
							setTargetSeconds((current) =>
								clampTargetSeconds({ value: current + TARGET_SECONDS_STEP }),
							)
						}
					>
						+
					</button>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">テロップスタイル</span>
				<Select
					value={selectedTemplateId}
					onValueChange={setSelectedTemplateId}
					disabled={isGenerating}
				>
					<SelectTrigger>
						<SelectValue placeholder="スタイルを選択" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={DEFAULT_TELOP_STYLE_ID}>
							既定（スタイルなし）
						</SelectItem>
						{templates.map((template) => (
							<SelectItem key={template.id} value={template.id}>
								{template.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-2">
				<Button
					type="button"
					variant="outline"
					className="w-full"
					disabled={isGenerating || !canGenerate}
					onClick={handleGenerateReview}
				>
					{isGenerating && <Spinner className="mr-1" />}
					{status.kind === "running" ? status.message : "確認しながら作る"}
				</Button>
				<Button
					type="button"
					className="w-full"
					disabled={isGenerating || !canGenerate}
					onClick={handleGenerateAuto}
				>
					全自動で作る
				</Button>
				{!selectedAsset && videoAssets.length > 0 && (
					<p className="text-muted-foreground text-center text-xs">
						上の「ソース動画」から1本選んでください
					</p>
				)}
			</div>

			{status.kind === "success" && (
				<div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3">
					<p className="text-sm text-emerald-700">
						{status.message ?? "AIショートを生成しました"}
					</p>
				</div>
			)}
			{status.kind === "error" && (
				<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
					<p className="text-destructive text-sm">{status.message}</p>
				</div>
			)}

			{reviewState && (
				<AiShortReviewDialog
					open={isReviewOpen}
					onOpenChange={setIsReviewOpen}
					initialPlan={reviewState.plan}
					segments={reviewState.segments}
					source={reviewState.source}
					editor={editor}
					telopStyleParams={telopStyleParams}
				/>
			)}
		</PanelView>
	);
}
