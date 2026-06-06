"use client";

import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { EditorCore } from "@/core";
import type { ParamValues } from "@/params";
import type { SourceVideo } from "@/short-gen/generate";
import { applyReviewedPlan } from "@/short-gen/generate";
import { planToClipSpecs, type SegmentInput } from "@/short-gen/plan-to-specs";
import {
	composePlanFromEditable,
	editableFromPlan,
	type EditableReview,
} from "@/short-gen/review-model";
import type { ComposePlan } from "@/short-gen/schema";
import { cn } from "@/utils/ui";

/** Format a number of seconds as M:SS, e.g. 750 → "12:30". */
function formatSeconds({ seconds }: { seconds: number }): string {
	const total = Math.max(0, Math.floor(seconds));
	const minutes = Math.floor(total / 60);
	const secs = total % 60;
	return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/** Circled order number ①②③… for connecting source ↔ short positions. */
function circledNumber({ order }: { order: number }): string {
	const circled = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
	return circled[order] ?? `(${order + 1})`;
}

/**
 * Move an item within an array, returning a new array. `from`/`to` are clamped
 * so out-of-range targets are no-ops.
 */
function arrayMove<T>({
	items,
	from,
	to,
}: {
	items: T[];
	from: number;
	to: number;
}): T[] {
	if (to < 0 || to >= items.length || from === to) {
		return items;
	}
	const next = [...items];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

export function AiShortReviewDialog({
	open,
	onOpenChange,
	initialPlan,
	segments,
	source,
	editor,
	telopStyleParams,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialPlan: ComposePlan;
	segments: SegmentInput[];
	source: SourceVideo;
	editor: EditorCore;
	telopStyleParams?: Partial<ParamValues>;
}) {
	const [review, setReview] = useState<EditableReview>(() =>
		editableFromPlan({ plan: initialPlan }),
	);
	const [isApplying, setIsApplying] = useState(false);

	// Re-initialize the editable review whenever a fresh plan is handed in (e.g.
	// the user re-generates). Done via the "adjust state during render on prop
	// change" pattern rather than an effect, so the new plan is reflected without
	// an extra render pass.
	const [seenPlan, setSeenPlan] = useState(initialPlan);
	if (seenPlan !== initialPlan) {
		setSeenPlan(initialPlan);
		setReview(editableFromPlan({ plan: initialPlan }));
	}

	const segmentByIndex = new Map<number, SegmentInput>();
	for (const seg of segments) {
		segmentByIndex.set(seg.index, seg);
	}

	const adoptedClips = review.clips.filter((clip) => clip.adopted);

	// NEW timestamps recompute every render from the live (edited) review, so the
	// right column always reflects the current adopted set and order.
	const preview = planToClipSpecs({
		plan: composePlanFromEditable({ review }),
		segments,
	});

	// Left column shares its order numbers with the right column: map each
	// adopted segmentIndex to its position in the adopted sequence.
	const orderBySegmentIndex = new Map<number, number>();
	adoptedClips.forEach((clip, index) => {
		orderBySegmentIndex.set(clip.segmentIndex, index);
	});

	const sourceTimeline = [...segments].sort((a, b) => a.start - b.start);

	const setHookText = (value: string) => {
		setReview((current) => ({ ...current, hookText: value }));
	};

	const setCtaText = (value: string) => {
		setReview((current) => ({ ...current, ctaText: value }));
	};

	const setCaption = ({
		clipIndex,
		value,
	}: {
		clipIndex: number;
		value: string;
	}) => {
		setReview((current) => ({
			...current,
			clips: current.clips.map((clip, index) =>
				index === clipIndex ? { ...clip, caption: value } : clip,
			),
		}));
	};

	const toggleAdopted = ({ clipIndex }: { clipIndex: number }) => {
		setReview((current) => ({
			...current,
			clips: current.clips.map((clip, index) =>
				index === clipIndex ? { ...clip, adopted: !clip.adopted } : clip,
			),
		}));
	};

	const moveClip = ({
		clipIndex,
		direction,
	}: {
		clipIndex: number;
		direction: -1 | 1;
	}) => {
		setReview((current) => ({
			...current,
			clips: arrayMove({
				items: current.clips,
				from: clipIndex,
				to: clipIndex + direction,
			}),
		}));
	};

	const handleApply = async () => {
		if (isApplying) return;
		if (adoptedClips.length === 0) {
			toast.error("クリップが1つも選ばれていません");
			return;
		}

		setIsApplying(true);
		try {
			const plan = composePlanFromEditable({ review });
			const result = await applyReviewedPlan({
				editor,
				plan,
				segments,
				source,
				telopStyleParams,
			});

			if (result.ok) {
				onOpenChange(false);
			} else {
				toast.error(result.reason);
			}
		} catch (error) {
			console.error("Failed to apply reviewed plan:", error);
			toast.error(
				error instanceof Error ? error.message : "反映に失敗しました",
			);
		} finally {
			setIsApplying(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>AIショートを確認・編集</DialogTitle>
				</DialogHeader>

				<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
					{/* LEFT — source order */}
					<div className="flex flex-col gap-2">
						<h2 className="text-muted-foreground text-sm font-medium">
							元の流れ（動画の時系列）
						</h2>
						<div className="flex flex-col gap-2">
							{sourceTimeline.map((seg) => {
								const order = orderBySegmentIndex.get(seg.index);
								const isUsed = order !== undefined;
								return (
									<div
										key={seg.index}
										className={cn(
											"flex items-center gap-3 rounded-lg border px-3 py-2",
											isUsed
												? "border-primary/40 bg-primary/5"
												: "border-dashed opacity-60",
										)}
									>
										<span className="w-6 shrink-0 text-center text-lg leading-none">
											{isUsed ? (
												circledNumber({ order })
											) : (
												<span className="text-muted-foreground text-xs">—</span>
											)}
										</span>
										<span className="text-muted-foreground w-24 shrink-0 text-xs tabular-nums">
											{formatSeconds({ seconds: seg.start })}–
											{formatSeconds({ seconds: seg.end })}
										</span>
										<span
											className={cn(
												"truncate text-sm",
												isUsed ? "" : "text-muted-foreground line-through",
											)}
										>
											音声「{seg.text}」
										</span>
									</div>
								);
							})}
						</div>
					</div>

					{/* RIGHT — short order */}
					<div className="flex flex-col gap-2">
						<h2 className="text-muted-foreground text-sm font-medium">
							ショート構成（並べ替え後）
						</h2>
						<div className="flex flex-col gap-2">
							<Card className="border-primary bg-primary/5">
								<CardContent className="flex flex-col gap-1.5 p-3">
									<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
										<Badge className="w-fit">フック</Badge>
										<span className="text-muted-foreground text-[11px] leading-tight">
											（サムネ・タイトル用 / 動画には表示されません）
										</span>
									</div>
									<Textarea
										value={review.hookText}
										onChange={(event) => setHookText(event.target.value)}
										aria-label="フック（サムネ・タイトル用 / 動画には表示されません）"
										className="min-h-[44px]"
									/>
								</CardContent>
							</Card>

							{review.clips.map((clip, clipIndex) => {
								const seg = segmentByIndex.get(clip.segmentIndex);
								const transcript = seg?.text ?? "";

								if (!clip.adopted) {
									return (
										<div
											key={clip.segmentIndex}
											className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 opacity-70"
										>
											<Badge variant="secondary" className="text-[10px]">
												除外済み
											</Badge>
											<span className="text-muted-foreground truncate text-xs line-through">
												テロップ：{clip.caption}
											</span>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="ml-auto h-7 shrink-0"
												aria-label="再追加"
												onClick={() => toggleAdopted({ clipIndex })}
											>
												<RotateCcw className="mr-1 size-3" />
												戻す
											</Button>
										</div>
									);
								}

								const adoptedOrder = orderBySegmentIndex.get(clip.segmentIndex);
								const previewClip =
									adoptedOrder !== undefined
										? preview.clips[adoptedOrder]
										: undefined;
								const newRange = previewClip
									? `${formatSeconds({
											seconds: previewClip.timelineStartSec,
										})}–${formatSeconds({
											seconds:
												previewClip.timelineStartSec + previewClip.durationSec,
										})}`
									: "—";

								return (
									<div
										key={clip.segmentIndex}
										className="flex flex-col gap-1.5 rounded-lg border px-3 py-2"
									>
										<div className="flex items-center gap-2">
											<span className="text-lg leading-none">
												{circledNumber({
													order: adoptedOrder ?? 0,
												})}
											</span>
											<span className="text-muted-foreground text-xs tabular-nums">
												{newRange}
											</span>
											<Badge variant="outline" className="ml-auto text-[10px]">
												テロップ
											</Badge>
											<div className="flex items-center">
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="size-7"
													aria-label="上へ"
													disabled={clipIndex === 0}
													onClick={() => moveClip({ clipIndex, direction: -1 })}
												>
													<ArrowUp className="!size-3.5" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="size-7"
													aria-label="下へ"
													disabled={clipIndex === review.clips.length - 1}
													onClick={() => moveClip({ clipIndex, direction: 1 })}
												>
													<ArrowDown className="!size-3.5" />
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="text-muted-foreground hover:text-destructive size-7"
													aria-label="除外"
													onClick={() => toggleAdopted({ clipIndex })}
												>
													<X className="!size-3.5" />
												</Button>
											</div>
										</div>
										<Input
											value={clip.caption}
											size="sm"
											onChange={(event) =>
												setCaption({ clipIndex, value: event.target.value })
											}
											aria-label={`テロップ ${(adoptedOrder ?? 0) + 1}`}
											className="font-medium"
										/>
										<p className="text-muted-foreground text-xs leading-snug">
											音声「{transcript}」
										</p>
									</div>
								);
							})}

							<Card className="border-dashed">
								<CardContent className="flex flex-col gap-1.5 p-3">
									<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
										<Badge variant="secondary" className="w-fit">
											CTA
										</Badge>
										<span className="text-muted-foreground text-[11px] leading-tight">
											（動画ラストに表示されます）
										</span>
									</div>
									<Textarea
										value={review.ctaText}
										onChange={(event) => setCtaText(event.target.value)}
										aria-label="CTA（動画ラストに表示されます）"
										className="min-h-[44px]"
									/>
								</CardContent>
							</Card>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={isApplying}
						onClick={() => onOpenChange(false)}
					>
						閉じる
					</Button>
					<Button
						type="button"
						disabled={isApplying || adoptedClips.length === 0}
						onClick={handleApply}
					>
						タイムラインに反映
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
