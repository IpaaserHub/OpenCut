"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useEditor } from "@/editor/use-editor";
import {
	applySilenceCut,
	extractSilenceSource,
	type SilenceSource,
} from "@/short-gen/cut-silence";
import {
	computeFrameRms,
	DEFAULT_SILENCE_OPTIONS,
	detectSilencesFromFrames,
	summarizeSilenceCut,
} from "@/short-gen/silence-detection";
import { cn } from "@/utils/ui";

/** Format a duration in seconds as M:SS. */
function formatDuration({ seconds }: { seconds: number | undefined }): string {
	if (!seconds || !Number.isFinite(seconds)) return "0:00";
	const total = Math.round(seconds);
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

type Status =
	| { kind: "idle" }
	| { kind: "running"; message: string }
	| { kind: "success"; message: string }
	| { kind: "error"; message: string };

/**
 * Plain-language strength presets. Each bundles the three raw knobs so the
 * everyday user picks an INTENT ("控えめ / おすすめ / しっかり") instead of a dB
 * value. The raw sliders still live behind "詳細設定" for fine control.
 */
const STRENGTH_PRESETS = [
	{
		id: "gentle",
		label: "控えめ",
		hint: "はっきりした無音だけ",
		thresholdDb: -50,
		minSilenceSec: 0.8,
		paddingSec: 0.15,
	},
	{
		id: "recommended",
		label: "おすすめ",
		hint: "バランス標準",
		thresholdDb: -40,
		minSilenceSec: 0.6,
		paddingSec: 0.1,
	},
	{
		id: "strong",
		label: "しっかり",
		hint: "テンポ優先で詰める",
		thresholdDb: -30,
		minSilenceSec: 0.4,
		paddingSec: 0.08,
	},
] as const;

type StrengthId = (typeof STRENGTH_PRESETS)[number]["id"] | "custom";

export function SilenceCutView() {
	const editor = useEditor();
	const videoAssets = useEditor((e) =>
		e.media.getAssets().filter((asset) => asset.type === "video"),
	);

	const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
	const [sourceOpen, setSourceOpen] = useState(false);
	const [source, setSource] = useState<SilenceSource | null>(null);
	const [isAnalyzing, setIsAnalyzing] = useState(false);
	const [isApplying, setIsApplying] = useState(false);
	const [appliedDone, setAppliedDone] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: "idle" });

	// Detection tuning. Defaults come from the pure module so the UI and the
	// algorithm never drift apart.
	const [thresholdDb, setThresholdDb] = useState(
		DEFAULT_SILENCE_OPTIONS.thresholdDb,
	);
	const [minSilenceSec, setMinSilenceSec] = useState(
		DEFAULT_SILENCE_OPTIONS.minSilenceSec,
	);
	const [paddingSec, setPaddingSec] = useState(
		DEFAULT_SILENCE_OPTIONS.paddingSec,
	);
	// Which strength preset is active ("custom" once a raw slider is touched).
	// Defaults align with "おすすめ" (= DEFAULT_SILENCE_OPTIONS).
	const [strength, setStrength] = useState<StrengthId>("recommended");
	const [detailOpen, setDetailOpen] = useState(false);

	const selectedAsset =
		videoAssets.find((asset) => asset.id === selectedSourceId) ?? null;
	const canAnalyze = selectedAsset !== null && selectedAsset.hasAudio !== false;

	// Re-detect instantly whenever a tuning knob moves — the decode (the only
	// expensive step) already happened, so this runs over cached PCM in memory.
	// The expensive RMS pass depends ONLY on the decoded samples (frameSec is
	// fixed), so compute it once per source. Dragging a slider then re-runs only
	// the cheap threshold/merge step below — keeping the preview responsive.
	const frames = useMemo(() => {
		if (!source) return null;
		return computeFrameRms({
			samples: source.samples,
			sampleRate: source.sampleRate,
			frameSec: DEFAULT_SILENCE_OPTIONS.frameSec,
		});
	}, [source]);

	const detection = useMemo(() => {
		if (!source || !frames) return null;
		const result = detectSilencesFromFrames({
			rms: frames,
			frameSec: DEFAULT_SILENCE_OPTIONS.frameSec,
			sampleRate: source.sampleRate,
			totalSec: source.samples.length / source.sampleRate,
			options: { thresholdDb, minSilenceSec, paddingSec },
		});
		const summary = summarizeSilenceCut({
			silences: result.silences,
			totalSec: result.totalSec,
		});
		return { result, summary };
	}, [source, frames, thresholdDb, minSilenceSec, paddingSec]);

	// Tile [0, total] with keep (kept speech) and cut (removed silence) blocks,
	// in time order, for the before/after bar.
	const timelineBlocks = useMemo(() => {
		if (!detection || detection.result.totalSec <= 0) return [];
		const { keep, silences, totalSec } = detection.result;
		return [
			...keep.map((iv) => ({ ...iv, type: "keep" as const })),
			...silences.map((iv) => ({ ...iv, type: "cut" as const })),
		]
			.sort((a, b) => a.startSec - b.startSec)
			.map((block) => ({
				type: block.type,
				widthPct: ((block.endSec - block.startSec) / totalSec) * 100,
			}));
	}, [detection]);

	const selectSource = (assetId: string) => {
		setSelectedSourceId(assetId);
		setSourceOpen(false);
		// A new pick invalidates the previous analysis.
		setSource(null);
		setAppliedDone(false);
		setStatus({ kind: "idle" });
	};

	// Apply a one-tap strength preset (sets all three raw knobs at once).
	const applyStrength = (preset: (typeof STRENGTH_PRESETS)[number]) => {
		setThresholdDb(preset.thresholdDb);
		setMinSilenceSec(preset.minSilenceSec);
		setPaddingSec(preset.paddingSec);
		setStrength(preset.id);
	};

	const handleAnalyze = async () => {
		if (isAnalyzing || !selectedAsset) return;
		setIsAnalyzing(true);
		setAppliedDone(false);
		setStatus({ kind: "running", message: "音声を解析中..." });
		try {
			const extracted = await extractSilenceSource({
				editor,
				asset: selectedAsset,
			});
			if (!extracted.ok) {
				setStatus({ kind: "error", message: extracted.reason });
				return;
			}
			setSource(extracted.source);
			setStatus({ kind: "idle" });
		} catch (error) {
			setStatus({
				kind: "error",
				message:
					error instanceof Error ? error.message : "解析に失敗しました",
			});
		} finally {
			setIsAnalyzing(false);
		}
	};

	const handleApply = async () => {
		if (isApplying || appliedDone || !source || !detection) return;
		if (detection.result.keep.length === 0) return;
		setIsApplying(true);
		setStatus({ kind: "running", message: "無音カットを適用中..." });
		try {
			const applied = await applySilenceCut({
				editor,
				descriptor: source.descriptor,
				keep: detection.result.keep,
				sceneName: `無音カット（${selectedAsset?.name ?? "動画"}）`,
			});
			if (!applied.ok) {
				setStatus({ kind: "error", message: applied.reason });
				return;
			}
			setAppliedDone(true);
			setStatus({
				kind: "success",
				message: "無音カット済みのシーンを作成しました",
			});
		} catch (error) {
			setStatus({
				kind: "error",
				message:
					error instanceof Error ? error.message : "適用に失敗しました",
			});
		} finally {
			setIsApplying(false);
		}
	};

	const busy = isAnalyzing || isApplying;

	return (
		<PanelView
			title="無音カット"
			contentClassName="flex flex-col gap-5 pb-4"
		>
			<p className="text-muted-foreground text-xs leading-relaxed">
				動画の「しゃべっていない間（無音）」を自動で見つけて詰めます。元の動画は
				そのまま、カット済みの新しいシーンを作るので安全です。
			</p>

			{/* ① ソース動画 */}
			<div className="flex flex-col gap-2">
				<span className="text-muted-foreground text-sm">対象の動画</span>
				{videoAssets.length === 0 ? (
					<p className="text-muted-foreground rounded-md border border-dashed p-3 text-xs">
						まずメディアに動画を追加してください。
					</p>
				) : (
					<Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
						<DialogTrigger asChild>
							<button
								type="button"
								disabled={busy}
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
								<DialogTitle>動画を選択</DialogTitle>
								<DialogDescription>
									無音カットの対象にする動画を選んでください。
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
												onClick={() => selectSource(asset.id)}
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
						この動画は音声が無いため無音カットできません。
					</p>
				)}
			</div>

			{/* ② 解析 */}
			<Button
				type="button"
				className="w-full"
				disabled={busy || !canAnalyze}
				onClick={handleAnalyze}
			>
				{isAnalyzing && <Spinner className="mr-1" />}
				{isAnalyzing ? "解析中..." : source ? "再解析" : "解析する"}
			</Button>

			{/* ③ 調整 + プレビュー */}
			{source && detection && (
				<>
					{/* 仕上がり（数値だけ） */}
					<div className="border-border bg-card flex items-baseline justify-between rounded-md border p-3">
						<span className="text-muted-foreground text-sm">仕上がり</span>
						<div className="text-right">
							<span className="text-sm font-semibold tabular-nums">
								{formatDuration({ seconds: detection.summary.originalSec })}
								<span className="text-muted-foreground mx-1">→</span>
								{formatDuration({ seconds: detection.summary.resultSec })}
							</span>
							<p className="text-muted-foreground text-xs">
								{detection.summary.removedCount}箇所・約
								{Math.round(detection.summary.removedSec)}秒カット
							</p>
						</div>
					</div>

					{/* カットの強さ：ボタン1タップ */}
					<div className="flex flex-col gap-2">
						<span className="text-muted-foreground flex items-center gap-2 text-sm">
							カットの強さ
							{strength === "custom" && (
								<span className="bg-accent text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">
									カスタム
								</span>
							)}
						</span>
						<div className="grid grid-cols-3 gap-2">
							{STRENGTH_PRESETS.map((preset) => {
								const isActive = strength === preset.id;
								return (
									<button
										key={preset.id}
										type="button"
										disabled={busy}
										onClick={() => applyStrength(preset)}
										className={cn(
											"flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 text-center transition-colors disabled:opacity-50",
											isActive
												? "border-primary bg-primary/10 ring-primary ring-2"
												: "border-border bg-accent hover:border-primary/50",
										)}
									>
										<span className="text-sm font-semibold">{preset.label}</span>
										<span className="text-muted-foreground text-[10px] leading-tight">
											{preset.hint}
										</span>
									</button>
								);
							})}
						</div>
					</div>

					{/* 詳細設定▷（細かいスライダー） */}
					<div className="flex flex-col gap-3">
						<button
							type="button"
							onClick={() => setDetailOpen((open) => !open)}
							className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
						>
							<ChevronDown
								className={cn(
									"size-3.5 transition-transform",
									detailOpen ? "" : "-rotate-90",
								)}
							/>
							詳細設定（自分で微調整）
						</button>

						{detailOpen && (
							<div className="border-border flex flex-col gap-4 rounded-md border border-dashed p-3">
								<div className="flex flex-col gap-1">
									<span className="text-muted-foreground flex justify-between text-xs">
										<span>カットの強さ（無音の判定・小さいほど控えめ）</span>
										<span className="tabular-nums">{thresholdDb} dB</span>
									</span>
									<input
										type="range"
										min={-60}
										max={-20}
										step={1}
										aria-label="カットの強さ（無音の判定）"
										value={thresholdDb}
										disabled={busy}
										onChange={(e) => {
											setThresholdDb(Number(e.target.value));
											setStrength("custom");
										}}
										className="w-full"
									/>
								</div>

								<div className="flex flex-col gap-1">
									<span className="text-muted-foreground flex justify-between text-xs">
										<span>これより短い「間」は残す</span>
										<span className="tabular-nums">
											{minSilenceSec.toFixed(1)} 秒
										</span>
									</span>
									<input
										type="range"
										min={0.2}
										max={2}
										step={0.1}
										aria-label="これより短い間は残す（秒）"
										value={minSilenceSec}
										disabled={busy}
										onChange={(e) => {
											setMinSilenceSec(Number(e.target.value));
											setStrength("custom");
										}}
										className="w-full"
									/>
								</div>

								<div className="flex flex-col gap-1">
									<span className="text-muted-foreground flex justify-between text-xs">
										<span>カット前後に残す余白（増やすとしゃべりが切れにくい）</span>
										<span className="tabular-nums">
											{paddingSec.toFixed(2)} 秒
										</span>
									</span>
									<input
										type="range"
										min={0}
										max={0.4}
										step={0.05}
										aria-label="カット前後に残す余白（秒）"
										value={paddingSec}
										disabled={busy}
										onChange={(e) => {
											setPaddingSec(Number(e.target.value));
											setStrength("custom");
										}}
										className="w-full"
									/>
								</div>
							</div>
						)}
					</div>

					{/* 今のバー（残す＝青／カット＝赤） */}
					<div className="flex flex-col gap-1.5">
						<div className="bg-muted flex h-3 w-full overflow-hidden rounded">
							{timelineBlocks.map((block, i) => (
								<div
									key={i}
									className={cn(
										"h-full",
										block.type === "keep" ? "bg-primary" : "bg-destructive/40",
									)}
									style={{ width: `${block.widthPct}%` }}
								/>
							))}
						</div>
						<div className="text-muted-foreground flex gap-3 text-[11px]">
							<span className="flex items-center gap-1">
								<span className="bg-primary inline-block size-2 rounded-sm" />
								残す
							</span>
							<span className="flex items-center gap-1">
								<span className="bg-destructive/40 inline-block size-2 rounded-sm" />
								カット
							</span>
						</div>
					</div>

					{/* ④ 適用 */}
					<Button
						type="button"
						className="w-full"
						disabled={
							busy || appliedDone || detection.result.keep.length === 0
						}
						onClick={handleApply}
					>
						{isApplying && <Spinner className="mr-1" />}
						{appliedDone
							? "出力済み"
							: isApplying
								? "出力中..."
								: "無音カットを適用（新しいシーン）"}
					</Button>
				</>
			)}

			{status.kind === "running" && !source && (
				<div className="text-muted-foreground flex items-center gap-2 text-sm">
					<Spinner /> {status.message}
				</div>
			)}
			{status.kind === "success" && (
				<div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3">
					<p className="text-sm text-emerald-700">{status.message}</p>
				</div>
			)}
			{status.kind === "error" && (
				<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
					<p className="text-destructive text-sm">{status.message}</p>
				</div>
			)}
		</PanelView>
	);
}
