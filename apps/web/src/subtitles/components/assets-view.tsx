import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useReducer, useRef, useState } from "react";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
} from "@/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/media/audio";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import {
	DEFAULT_CAPTION_LINE_CHARACTERS,
	MAX_CAPTION_LINE_CHARACTERS,
	MIN_CAPTION_LINE_CHARACTERS,
} from "@/transcription/caption-defaults";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

function clampCaptionLineCharacterCount({ value }: { value: number }): number {
	return Math.min(
		MAX_CAPTION_LINE_CHARACTERS,
		Math.max(MIN_CAPTION_LINE_CHARACTERS, value),
	);
}

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("ja");
	const [lineCharacterCount, setLineCharacterCount] = useState(
		DEFAULT_CAPTION_LINE_CHARACTERS,
	);
	const [lineCharacterCountInput, setLineCharacterCountInput] = useState(
		String(DEFAULT_CAPTION_LINE_CHARACTERS),
	);
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `モデルを読み込み中 ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "文字起こし中..." });
		}
	};

	const insertCaptions = ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "音声を抽出中..." });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({ type: "update_step", step: "音声を準備中..." });
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
			});

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage,
				onProgress: handleProgress,
			});

			dispatch({ type: "update_step", step: "字幕を生成中..." });
			const captionChunks = buildCaptionChunks({
				segments: result.segments,
				lineCharacterCount,
			});

			if (!insertCaptions({ captions: captionChunks })) {
				dispatch({ type: "fail", error: "字幕を生成できませんでした" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "予期しないエラーが発生しました",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "字幕ファイルを読み込み中..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "字幕ファイルに有効な字幕データが見つかりませんでした",
				});
				return;
			}

			dispatch({ type: "update_step", step: "字幕を読み込み中..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "字幕を生成できませんでした" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`${result.captions.length} 件の字幕を読み込み、形式が不正な ${result.skippedCueCount} 件をスキップしました。`,
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "予期しないエラーが発生しました",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const commitLineCharacterCount = ({ value }: { value: number }) => {
		const nextValue = clampCaptionLineCharacterCount({ value });
		setLineCharacterCount(nextValue);
		setLineCharacterCountInput(String(nextValue));
	};

	const handleLineCharacterInputChange = ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const nextInput = event.target.value.replace(/\D/g, "");
		setLineCharacterCountInput(nextInput);

		if (!nextInput) return;

		const parsedValue = Number.parseInt(nextInput, 10);
		if (Number.isFinite(parsedValue)) {
			commitLineCharacterCount({ value: parsedValue });
		}
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="字幕"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							読み込み
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="言語">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="言語を選択" />
								</SelectTrigger>
								<SelectContent>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="改行文字数">
							<div className="border-border bg-accent focus-within:border-primary flex h-7 w-full overflow-hidden rounded-md border">
								<input
									type="text"
									inputMode="numeric"
									pattern="[0-9]*"
									value={lineCharacterCountInput}
									onChange={(event) =>
										handleLineCharacterInputChange({ event })
									}
									onBlur={() =>
										commitLineCharacterCount({ value: lineCharacterCount })
									}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === "Escape") {
											event.currentTarget.blur();
										}
									}}
									aria-label="改行文字数"
									className="min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
								/>
								<div className="border-border flex w-7 shrink-0 flex-col border-l">
									<button
										type="button"
										aria-label="改行文字数を増やす"
										disabled={
											lineCharacterCount >= MAX_CAPTION_LINE_CHARACTERS
										}
										className="hover:bg-background/70 flex min-h-0 flex-1 items-center justify-center text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
										onClick={() =>
											commitLineCharacterCount({
												value: lineCharacterCount + 1,
											})
										}
									>
										<ChevronUp className="size-3" />
									</button>
									<button
										type="button"
										aria-label="改行文字数を減らす"
										disabled={
											lineCharacterCount <= MIN_CAPTION_LINE_CHARACTERS
										}
										className="hover:bg-background/70 flex min-h-0 flex-1 items-center justify-center border-border border-t text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
										onClick={() =>
											commitLineCharacterCount({
												value: lineCharacterCount - 1,
											})
										}
									>
										<ChevronDown className="size-3" />
									</button>
								</div>
							</div>
						</SectionField>
					</SectionFields>

					<Button
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={isProcessing || activeDiagnostics.length > 0}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : "文字起こしを生成"}
					</Button>
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
