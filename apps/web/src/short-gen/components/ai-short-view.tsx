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
import {
	BUILT_IN_TEXT_TEMPLATES,
	TextTemplatePreview,
	buildTextParams,
} from "@/text/components/assets-view";
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
	const [telopOpen, setTelopOpen] = useState(false);
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
	const [detailIndex, setDetailIndex] = useState<number | null>(null);
	const [appliedDone, setAppliedDone] = useState(false);

	const selectedAsset =
		videoAssets.find((asset) => asset.id === selectedSourceId) ?? null;
	const canTranscribe =
		selectedAsset !== null && selectedAsset.hasAudio !== false;
	// All shorts in a batch share the picked source, so its thumbnail is a real
	// frame we can show in previews (per-clip-accurate frames would need rendering).
	const sourceThumb = selectedAsset?.thumbnailUrl ?? null;
	const compositionOrder: CompositionOrder = PRESETS.map((p) => ({
		presetId: p.id,
		count: order[p.id] ?? 0,
	}));
	const total = totalCount({ order: compositionOrder });
	const okShorts = prepared.filter((p) => p.ok).length;

	// Built-in telop styles first, then the user's saved templates.
	const telopStyles = [...BUILT_IN_TEXT_TEMPLATES, ...templates];
	const selectedTelop = telopStyles.find((t) => t.id === selectedTemplateId);
	const telopStyleParams =
		selectedTemplateId === DEFAULT_TELOP_STYLE_ID
			? undefined
			: selectedTelop?.params;

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
			setDetailIndex(null);
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
			setDetailIndex(null);
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

	const detailShort = detailIndex !== null ? prepared[detailIndex] : null;

	// Edit a specific short's clips (reorder / remove), renumbering `order`.
	const editDetailClips = (
		transform: (clips: { segmentIndex: number; order: number; caption: string }[]) => {
			segmentIndex: number;
			order: number;
			caption: string;
		}[],
	) => {
		if (detailIndex === null) return;
		setPrepared((prev) =>
			prev.map((short, i) => {
				if (i !== detailIndex || !short.ok) return short;
				const sorted = [...short.plan.clips].sort((a, b) => a.order - b.order);
				const next = transform(sorted).map((clip, k) => ({ ...clip, order: k }));
				return { ...short, plan: { ...short.plan, clips: next } };
			}),
		);
	};
	const removeClipAt = (pos: number) =>
		editDetailClips((clips) =>
			clips.length > 1 ? clips.filter((_, i) => i !== pos) : clips,
		);
	const moveClipAt = ({ pos, dir }: { pos: number; dir: -1 | 1 }) =>
		editDetailClips((clips) => {
			const target = pos + dir;
			if (target < 0 || target >= clips.length) return clips;
			const copy = [...clips];
			const [moved] = copy.splice(pos, 1);
			copy.splice(target, 0, moved);
			return copy;
		});

	/** Look up a clip's source segment (for its timestamp/duration). */
	const segmentForClip = ({
		short,
		segmentIndex,
	}: {
		short: Extract<PreparedShort, { ok: true }>;
		segmentIndex: number;
	}) => short.segments.find((s) => s.index === segmentIndex);

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

								{/* テロップスタイル（プレビュー付きで選択） */}
								<div className="flex flex-col gap-2">
									<span className="text-muted-foreground text-sm">
										テロップスタイル
									</span>
									<Dialog open={telopOpen} onOpenChange={setTelopOpen}>
										<DialogTrigger asChild>
											<button
												type="button"
												disabled={isGenerating}
												className="border-border bg-accent hover:border-primary/50 flex items-center gap-2 rounded-md border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
											>
												<span className="flex-1 truncate text-sm">
													{selectedTemplateId === DEFAULT_TELOP_STYLE_ID
														? "既定（スタイルなし）"
														: (selectedTelop?.name ?? "スタイルを選択")}
												</span>
												<ChevronDown className="text-muted-foreground size-4 shrink-0" />
											</button>
										</DialogTrigger>
										<DialogContent className="z-[300] max-w-lg">
											<DialogHeader>
												<DialogTitle>テロップスタイルを選択</DialogTitle>
												<DialogDescription>
													見た目を確認して選べます。
												</DialogDescription>
											</DialogHeader>
											<DialogBody className="max-h-[60vh] overflow-y-auto">
												<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
													<button
														type="button"
														onClick={() => {
															setSelectedTemplateId(DEFAULT_TELOP_STYLE_ID);
															setTelopOpen(false);
														}}
														className={cn(
															"flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors",
															selectedTemplateId === DEFAULT_TELOP_STYLE_ID
																? "border-primary bg-primary/10 ring-primary ring-2"
																: "border-border bg-accent hover:border-primary/50",
														)}
													>
														<div className="bg-muted text-muted-foreground/60 flex aspect-video w-full items-center justify-center rounded text-xs">
															なし
														</div>
														<span className="truncate text-xs font-medium">
															既定（スタイルなし）
														</span>
													</button>
													{telopStyles.map((style) => {
														const isSelected = style.id === selectedTemplateId;
														return (
															<button
																key={style.id}
																type="button"
																onClick={() => {
																	setSelectedTemplateId(style.id);
																	setTelopOpen(false);
																}}
																className={cn(
																	"flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-colors",
																	isSelected
																		? "border-primary bg-primary/10 ring-primary ring-2"
																		: "border-border bg-accent hover:border-primary/50",
																)}
															>
																<div className="aspect-video w-full overflow-hidden rounded">
																	<TextTemplatePreview
																		params={buildTextParams({ params: style.params })}
																	/>
																</div>
																<span className="truncate text-xs font-medium">
																	{style.name}
																</span>
															</button>
														);
													})}
												</div>
											</DialogBody>
										</DialogContent>
									</Dialog>
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

						{phase === "results" && detailShort?.ok && (
							/* ---- 個別レビュー（B 構成 ＋ C 縦型プレビュー）---- */
							<>
								<div className="flex items-center gap-2">
									<button
										type="button"
										disabled={isGenerating}
										onClick={() => setDetailIndex(null)}
										className="border-border hover:bg-accent rounded-md border px-2.5 py-1 text-sm disabled:opacity-50"
									>
										← 一覧
									</button>
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold">
											{detailShort.plan.hookText || "(フックなし)"}
										</p>
										<p className="text-muted-foreground text-xs">
											{presetLabel(detailShort.presetId)} ・
											{Math.round(detailShort.plan.estimatedSeconds)}秒 ・
											クリップ{detailShort.plan.clips.length}本
										</p>
									</div>
								</div>

								<div className="grid gap-4 md:grid-cols-[1fr_200px]">
									{/* B: 構成（並べ替え ▲▼ ・除外 ×） */}
									<div className="flex flex-col gap-2">
										<span className="text-muted-foreground text-xs font-medium">
											構成（▲▼で並べ替え・×で除外）
										</span>
										<div className="bg-primary/10 border-primary flex items-center gap-2 rounded-lg border p-2.5">
											<span className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold">
												◎
											</span>
											<div className="min-w-0">
												<span className="text-muted-foreground text-xs">フック</span>
												<p className="truncate text-sm font-medium">
													{detailShort.plan.hookText || "(フックなし)"}
												</p>
											</div>
										</div>
										{[...detailShort.plan.clips]
											.sort((a, b) => a.order - b.order)
											.map((clip, pos, arr) => {
												const seg = segmentForClip({
													short: detailShort,
													segmentIndex: clip.segmentIndex,
												});
												return (
													<div
														key={clip.order}
														className="border-border bg-card flex items-center gap-2 rounded-lg border p-2"
													>
														<div className="flex flex-col leading-none">
															<button
																type="button"
																aria-label="上へ"
																disabled={pos === 0}
																onClick={() => moveClipAt({ pos, dir: -1 })}
																className="text-muted-foreground hover:text-foreground text-[10px] disabled:opacity-30"
															>
																▲
															</button>
															<button
																type="button"
																aria-label="下へ"
																disabled={pos === arr.length - 1}
																onClick={() => moveClipAt({ pos, dir: 1 })}
																className="text-muted-foreground hover:text-foreground text-[10px] disabled:opacity-30"
															>
																▼
															</button>
														</div>
														<span className="bg-accent flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
															{pos + 1}
														</span>
														<span className="text-muted-foreground w-14 shrink-0 text-[11px] tabular-nums">
															{seg
																? `${formatDuration({ seconds: seg.start })}・${Math.max(0, Math.round(seg.end - seg.start))}s`
																: "--"}
														</span>
														<p className="min-w-0 flex-1 text-sm leading-snug">
															{clip.caption}
														</p>
														<button
															type="button"
															aria-label="除外"
															disabled={arr.length === 1}
															onClick={() => removeClipAt(pos)}
															className="text-muted-foreground hover:text-destructive shrink-0 px-1 text-lg disabled:opacity-30"
														>
															×
														</button>
													</div>
												);
											})}
										<div className="border-border bg-card flex items-center gap-2 rounded-lg border border-dashed p-2.5">
											<span className="bg-accent flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
												END
											</span>
											<div className="min-w-0">
												<span className="text-muted-foreground text-xs">CTA</span>
												<p className="truncate text-sm font-medium">
													{detailShort.plan.ctaText || "(なし)"}
												</p>
											</div>
										</div>
									</div>

									{/* C: 縦型プレビュー */}
									<div className="flex flex-col items-center gap-2">
										<span className="text-muted-foreground self-start text-xs font-medium">
											プレビュー（縦型 9:16）
										</span>
										<div className="bg-foreground/95 flex w-[180px] flex-col gap-1.5 rounded-2xl p-2.5 shadow-lg">
											<div className="rounded bg-white/15 px-2 py-1 text-center text-[11px] font-bold text-white">
												{detailShort.plan.hookText || ""}
											</div>
											{[...detailShort.plan.clips]
												.sort((a, b) => a.order - b.order)
												.map((clip) => (
													<div
														key={clip.order}
														className="bg-muted relative flex aspect-video items-end overflow-hidden rounded"
													>
														{sourceThumb ? (
															<Image
																src={sourceThumb}
																alt=""
																fill
																sizes="180px"
																className="object-cover"
																unoptimized
															/>
														) : null}
														<span className="relative w-full bg-black/55 px-1 py-0.5 text-center text-[10px] font-bold leading-tight text-white">
															{clip.caption}
														</span>
													</div>
												))}
											<div className="rounded bg-white/90 px-2 py-1 text-center text-[10px] font-bold text-black">
												{detailShort.plan.ctaText || ""} →
											</div>
										</div>
									</div>
								</div>

								<Button
									type="button"
									className="w-full"
									disabled={isGenerating || appliedDone || okShorts === 0}
									onClick={handleApplyAll}
								>
									{isGenerating && <Spinner className="mr-1" />}
									{appliedDone ? "出力済み" : `全${okShorts}本をタイムラインに出力`}
								</Button>
							</>
						)}

						{phase === "results" && !detailShort?.ok && (
							/* ---- 候補一覧（ギャラリー）---- */
							<>
								<div className="flex items-center gap-2">
									<button
										type="button"
										disabled={isGenerating}
										onClick={() => {
											setPhase("config");
											setDetailIndex(null);
											setAppliedDone(false);
											setStatus({ kind: "idle" });
										}}
										className="border-border hover:bg-accent rounded-md border px-2.5 py-1 text-sm disabled:opacity-50"
									>
										← 構成に戻る
									</button>
									<span className="text-sm font-medium">{okShorts}本の候補</span>
								</div>
								<p className="text-muted-foreground text-xs">
									カードを開くと個別に確認・微調整できます。
								</p>

								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
										return (
											<button
												key={`ok-${index}`}
												type="button"
												onClick={() => setDetailIndex(index)}
												className="border-border hover:border-primary/60 flex flex-col overflow-hidden rounded-lg border text-left transition-colors"
											>
												<div className="bg-muted relative flex aspect-video items-center justify-center overflow-hidden">
													{sourceThumb ? (
														<Image
															src={sourceThumb}
															alt=""
															fill
															sizes="(max-width: 640px) 100vw, 320px"
															className="object-cover"
															unoptimized
														/>
													) : (
														<span className="text-muted-foreground/60 text-xs">
															▶ プレビュー
														</span>
													)}
													<span className="bg-primary/90 absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium text-white">
														{presetLabel(short.presetId)}
													</span>
													<span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
														できあがり {Math.round(short.plan.estimatedSeconds)}秒
													</span>
												</div>
												<div className="p-2.5">
													<p className="truncate text-sm font-medium">
														{short.plan.hookText || "(フックなし)"}
													</p>
													<p className="text-muted-foreground truncate text-xs">
														切り抜き{short.plan.clips.length}本
													</p>
												</div>
											</button>
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
