"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useEditor } from "@/editor/use-editor";
import {
	applyShorts,
	prepareShorts,
	type PreparedShort,
} from "@/short-gen/generate";
import { totalCount, type CompositionOrder } from "@/short-gen/batch";
import { PRESETS } from "@/short-gen/presets";
import { useTranscriptSegments } from "@/short-gen/segments-store";
import { sourceVideoFromAsset } from "@/short-gen/source-video";
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
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/utils/ui";

const LENGTH_PRESETS = [15, 30, 60] as const;
/** Sentinel for the "no template" option — Radix forbids an empty-string item value. */
const DEFAULT_TELOP_STYLE_ID = "__default__";
const DEFAULT_TARGET_SECONDS = 30;

/** Format a duration in seconds as M:SS. */
function formatDuration({ seconds }: { seconds: number | undefined }): string {
	if (!seconds || !Number.isFinite(seconds)) return "0:00";
	const total = Math.round(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

const presetLabel = (presetId: string) =>
	PRESETS.find((p) => p.id === presetId)?.label ?? presetId;

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
	// Subscribe to the transcript so the config step shows it once it's ready.
	const transcript = useTranscriptSegments((s) => s.segments);

	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
	const [sourceOpen, setSourceOpen] = useState(false);
	const [language, setLanguage] = useState<TranscriptionLanguage>("ja");
	// Composition order: how many shorts of each preset. Default = 1 of the first
	// preset (an order summing to 1 is just the single-short case).
	const [order, setOrder] = useState<Record<string, number>>(() => ({
		[PRESETS[0].id]: 1,
	}));
	const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
		DEFAULT_TELOP_STYLE_ID,
	);
	const [targetSeconds, setTargetSeconds] = useState<number>(
		DEFAULT_TARGET_SECONDS,
	);
	const [isGenerating, setIsGenerating] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: "idle" });
	// 作成 opens a popup; inside it: 'config' (transcript + order) → 'results'.
	const [dialogOpen, setDialogOpen] = useState(false);
	const [phase, setPhase] = useState<"config" | "results">("config");
	const [prepared, setPrepared] = useState<PreparedShort[]>([]);
	const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
	const [appliedDone, setAppliedDone] = useState(false);

	const selectedAsset =
		videoAssets.find((asset) => asset.id === selectedSourceId) ?? null;
	const canTranscribe =
		selectedAsset !== null && selectedAsset.hasAudio !== false;
	const compositionOrder: CompositionOrder = PRESETS.map((p) => ({
		presetId: p.id,
		count: order[p.id] ?? 0,
	}));
	const total = totalCount({ order: compositionOrder });
	const okShorts = prepared.filter((p) => p.ok).length;

	const telopStyleParams =
		selectedTemplateId === DEFAULT_TELOP_STYLE_ID
			? undefined
			: templates.find((template) => template.id === selectedTemplateId)
					?.params;

	const setPresetCount = ({
		presetId,
		delta,
	}: {
		presetId: string;
		delta: number;
	}) =>
		setOrder((prev) => ({
			...prev,
			[presetId]: Math.max(0, (prev[presetId] ?? 0) + delta),
		}));

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

	const onDialogOpenChange = (open: boolean) => {
		setDialogOpen(open);
		if (!open) {
			// Reset the in-dialog flow so the next 作成 starts clean (keep settings).
			setPhase("config");
			setPrepared([]);
			setExpandedIndex(null);
			setAppliedDone(false);
			setStatus({ kind: "idle" });
		}
	};

	// Step ②: transcribe the picked source (reusing any cached transcript), then
	// open the popup at the config step.
	const handleTranscribe = async () => {
		if (isGenerating || !selectedAsset) return;
		setIsGenerating(true);
		try {
			const store = useTranscriptSegments.getState();
			const alreadyCurrent =
				store.sourceMediaId === selectedAsset.id && store.segments.length > 0;
			// Reuse a cached transcript (this session or a previous one) before
			// re-transcribing — a video is transcribed only once.
			if (!alreadyCurrent && !store.loadCached({ mediaId: selectedAsset.id })) {
				setStatus({ kind: "running", message: "文字起こし中..." });
				await transcribeMediaAsset({
					editor,
					asset: selectedAsset,
					language,
					onProgress: handleProgress,
				});
			}
			setPhase("config");
			setPrepared([]);
			setAppliedDone(false);
			setStatus({ kind: "idle" });
			setDialogOpen(true);
		} catch (error) {
			console.error("Transcription failed:", error);
			setStatus({
				kind: "error",
				message:
					error instanceof Error ? error.message : "文字起こしに失敗しました",
			});
		} finally {
			setIsGenerating(false);
		}
	};

	// Step ③→④: generate N distinct shorts from the (already transcribed) source.
	const handleCreate = async () => {
		if (isGenerating || !selectedAsset || total === 0) return;
		setIsGenerating(true);
		try {
			setStatus({ kind: "running", message: `${total}本を生成中...` });
			const results = await prepareShorts({
				editor,
				source: sourceVideoFromAsset({ asset: selectedAsset }),
				order: compositionOrder,
				targetSeconds,
			});

			setPrepared(results);
			setExpandedIndex(null);
			setAppliedDone(false);
			setPhase("results");
			const ok = results.filter((r) => r.ok).length;
			setStatus(
				ok === 0
					? { kind: "error", message: "ショートを生成できませんでした" }
					: { kind: "idle" },
			);
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

	const handleApplyAll = async () => {
		if (isGenerating || appliedDone || okShorts === 0) return;
		setIsGenerating(true);
		try {
			setStatus({ kind: "running", message: "タイムラインに出力中..." });
			const applied = await applyShorts({ editor, prepared, telopStyleParams });
			const ok = applied.filter((a) => a.ok).length;
			setAppliedDone(true);
			setStatus({ kind: "success", message: `${ok}本をシーンに出力しました` });
		} catch (error) {
			console.error("AI short apply failed:", error);
			setStatus({
				kind: "error",
				message:
					error instanceof Error ? error.message : "出力中にエラーが発生しました",
			});
		} finally {
			setIsGenerating(false);
		}
	};

	return (
		<>
			<PanelView title="AIショート" contentClassName="flex flex-col gap-5 pb-4">
				{/* ① ソース動画 + 言語 → 作成。文字起こし以降は作成後にポップアップで表示。 */}
				<div className="flex flex-col gap-2">
					<span className="text-muted-foreground text-sm">ソース動画</span>
					{videoAssets.length === 0 ? (
						<p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
							まずメディアに動画を追加してください。
						</p>
					) : (
						<Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
							<DialogTrigger asChild>
								<button
									type="button"
									disabled={isGenerating}
									className="border-border bg-accent hover:border-primary/50 flex items-center gap-2 rounded-md border p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
								>
									{selectedAsset ? (
										<>
											<div className="relative h-9 w-16 shrink-0 overflow-hidden rounded">
												{selectedAsset.thumbnailUrl ? (
													<Image
														src={selectedAsset.thumbnailUrl}
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
											<div className="flex min-w-0 flex-1 flex-col">
												<span className="truncate text-sm">
													{selectedAsset.name}
												</span>
												<span className="text-muted-foreground text-xs">
													{formatDuration({ seconds: selectedAsset.duration })}
													{selectedAsset.hasAudio === false ? " ・音声なし" : ""}
												</span>
											</div>
										</>
									) : (
										<span className="text-muted-foreground flex-1 text-sm">
											動画を選択...
										</span>
									)}
									<ChevronDown className="text-muted-foreground size-4 shrink-0" />
								</button>
							</DialogTrigger>
							<DialogContent className="max-w-2xl">
								<DialogHeader>
									<DialogTitle>ソース動画を選択</DialogTitle>
									<DialogDescription>
										ショートの元になる動画を選んでください。
									</DialogDescription>
								</DialogHeader>
								<DialogBody className="max-h-[60vh] overflow-y-auto">
									<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
										{videoAssets.map((asset) => {
											const isSelected = asset.id === selectedSourceId;
											return (
												<button
													key={asset.id}
													type="button"
													onClick={() => {
														setSelectedSourceId(asset.id);
														setSourceOpen(false);
													}}
													className={cn(
														"flex flex-col gap-2 rounded-lg border p-2 text-left transition-colors",
														isSelected
															? "border-primary bg-primary/10 ring-primary ring-2"
															: "border-border bg-accent hover:border-primary/50",
													)}
												>
													<div className="bg-muted relative aspect-video w-full overflow-hidden rounded">
														{asset.thumbnailUrl ? (
															<Image
																src={asset.thumbnailUrl}
																alt=""
																fill
																sizes="(max-width: 640px) 50vw, 220px"
																className="object-cover"
																unoptimized
															/>
														) : null}
													</div>
													<div className="flex min-w-0 flex-col">
														<span className="truncate text-sm font-medium">
															{asset.name}
														</span>
														<span className="text-muted-foreground text-xs">
															{formatDuration({ seconds: asset.duration })}
															{asset.hasAudio === false ? " ・音声なし" : ""}
														</span>
													</div>
												</button>
											);
										})}
									</div>
								</DialogBody>
							</DialogContent>
						</Dialog>
					)}
					{selectedAsset?.hasAudio === false && (
						<p className="text-destructive text-xs">
							この動画は音声が無いため文字起こしできません。
						</p>
					)}
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
					<Button
						type="button"
						className="w-full"
						disabled={isGenerating || !canTranscribe}
						onClick={handleTranscribe}
					>
						{isGenerating && !dialogOpen && <Spinner className="mr-1" />}
						{isGenerating && !dialogOpen
							? status.kind === "running"
								? status.message
								: "処理中..."
							: "作成（文字起こし→構成）"}
					</Button>
					{!selectedAsset && videoAssets.length > 0 && (
						<p className="text-muted-foreground text-center text-xs">
							上の「ソース動画」から1本選んでください
						</p>
					)}
					{!dialogOpen && status.kind === "error" && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{status.message}</p>
						</div>
					)}
				</div>
			</PanelView>

			{/* 作成後のポップアップ：②構成オーダー → ③出力 */}
			<Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{phase === "config"
								? "文字起こし完了 → 構成を決める"
								: `生成結果（${okShorts}本）`}
						</DialogTitle>
						{selectedAsset ? (
							<DialogDescription>{selectedAsset.name}</DialogDescription>
						) : null}
					</DialogHeader>
					<DialogBody className="flex max-h-[70vh] flex-col gap-5 overflow-y-auto">
						{phase === "config" && (
							<>
								{/* 文字起こし結果 */}
								<div className="flex flex-col gap-2">
									<span className="text-muted-foreground text-sm">
										文字起こし（{transcript.length}セグメント）
									</span>
									<div className="border-border bg-card max-h-48 overflow-y-auto rounded-md border p-2.5">
										{transcript.length === 0 ? (
											<p className="text-muted-foreground text-xs">
												文字起こし結果がありません。
											</p>
										) : (
											transcript.map((seg, i) => (
												<p
													key={`${seg.start}-${i}`}
													className="mb-1.5 text-xs leading-relaxed"
												>
													<span className="text-muted-foreground mr-1.5 tabular-nums">
														{formatDuration({ seconds: seg.start })}
													</span>
													{seg.text}
												</p>
											))
										)}
									</div>
								</div>

								{/* 構成オーダー */}
								<div className="flex flex-col gap-2">
									<span className="text-muted-foreground text-sm">
										構成オーダー（本数を構成ごとに指定）
									</span>
									{PRESETS.map((preset) => {
										const count = order[preset.id] ?? 0;
										return (
											<div
												key={preset.id}
												className={cn(
													"flex items-center gap-2 rounded-md border p-2.5",
													count > 0
														? "border-primary bg-primary/5"
														: "border-border bg-card",
												)}
											>
												<div className="min-w-0 flex-1">
													<p className="text-sm font-medium">{preset.label}</p>
													<p className="text-muted-foreground truncate text-xs">
														{preset.description}
													</p>
												</div>
												<div className="flex items-center gap-1">
													<button
														type="button"
														aria-label={`${preset.label}を減らす`}
														disabled={isGenerating || count === 0}
														onClick={() =>
															setPresetCount({ presetId: preset.id, delta: -1 })
														}
														className="border-border hover:bg-accent size-7 rounded-md border text-sm disabled:opacity-40"
													>
														−
													</button>
													<span className="w-6 text-center text-sm font-semibold tabular-nums">
														{count}
													</span>
													<button
														type="button"
														aria-label={`${preset.label}を増やす`}
														disabled={isGenerating}
														onClick={() =>
															setPresetCount({ presetId: preset.id, delta: 1 })
														}
														className="border-border hover:bg-accent size-7 rounded-md border text-sm"
													>
														＋
													</button>
												</div>
											</div>
										);
									})}
								</div>

								{/* 長さ */}
								<div className="flex flex-col gap-2">
									<span className="text-muted-foreground text-sm">
										長さ（1本あたり）
									</span>
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
								</div>

								{/* テロップスタイル */}
								<div className="flex flex-col gap-2">
									<span className="text-muted-foreground text-sm">
										テロップスタイル
									</span>
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

								<Button
									type="button"
									className="w-full"
									disabled={isGenerating || total === 0}
									onClick={handleCreate}
								>
									{isGenerating && <Spinner className="mr-1" />}
									{isGenerating
										? status.kind === "running"
											? status.message
											: "生成中..."
										: `${total}本を作成`}
								</Button>
							</>
						)}

						{phase === "results" && (
							<>
								<div className="flex items-center gap-2">
									<button
										type="button"
										disabled={isGenerating}
										onClick={() => {
											setPhase("config");
											setExpandedIndex(null);
											setAppliedDone(false);
											setStatus({ kind: "idle" });
										}}
										className="border-border hover:bg-accent rounded-md border px-2.5 py-1 text-sm disabled:opacity-50"
									>
										← 構成に戻る
									</button>
									<span className="text-sm font-medium">{okShorts}本の候補</span>
								</div>

								<div className="flex flex-col gap-2">
									{prepared.map((short, index) => {
										if (!short.ok) {
											return (
												<div
													key={`fail-${index}`}
													className="border-destructive/30 bg-destructive/5 rounded-md border p-2.5"
												>
													<p className="text-destructive text-xs">
														{presetLabel(short.presetId)}：{short.reason}
													</p>
												</div>
											);
										}
										const isOpen = expandedIndex === index;
										return (
											<div
												key={`ok-${index}`}
												className="border-border bg-card overflow-hidden rounded-lg border"
											>
												<button
													type="button"
													onClick={() => setExpandedIndex(isOpen ? null : index)}
													className="hover:bg-accent flex w-full items-center gap-2 p-2.5 text-left"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-1.5">
															<span className="bg-primary/90 rounded px-1.5 py-0.5 text-[10px] font-medium text-white">
																{presetLabel(short.presetId)}
															</span>
															<span className="text-muted-foreground text-xs">
																{Math.round(short.plan.estimatedSeconds)}秒 ・
																クリップ{short.plan.clips.length}本
															</span>
														</div>
														<p className="mt-1 truncate text-sm font-medium">
															{short.plan.hookText || "(フックなし)"}
														</p>
													</div>
													<ChevronDown
														className={cn(
															"text-muted-foreground size-4 shrink-0 transition-transform",
															isOpen && "rotate-180",
														)}
													/>
												</button>
												{isOpen && (
													<div className="border-border flex flex-col gap-1 border-t p-2.5">
														{short.plan.clips.map((clip) => (
															<div
																key={clip.order}
																className="flex gap-2 text-xs"
															>
																<span className="bg-accent flex size-5 shrink-0 items-center justify-center rounded-full font-bold">
																	{clip.order + 1}
																</span>
																<span className="flex-1">{clip.caption}</span>
															</div>
														))}
														<p className="text-muted-foreground mt-1 text-xs">
															CTA：{short.plan.ctaText || "(なし)"}
														</p>
													</div>
												)}
											</div>
										);
									})}
								</div>

								<Button
									type="button"
									className="w-full"
									disabled={isGenerating || appliedDone || okShorts === 0}
									onClick={handleApplyAll}
								>
									{isGenerating && <Spinner className="mr-1" />}
									{appliedDone
										? "出力済み"
										: isGenerating
											? status.kind === "running"
												? status.message
												: "出力中..."
											: `全${okShorts}本をタイムラインに出力`}
								</Button>
							</>
						)}

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
					</DialogBody>
				</DialogContent>
			</Dialog>
		</>
	);
}
