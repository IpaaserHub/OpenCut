"use client";

import { useMemo } from "react";
import { OcRippleIcon } from "@/components/icons";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TimelineTrack } from "@/timeline";
import { findTrackGaps } from "@/timeline/placement";
import { useEditor } from "@/editor/use-editor";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { TIMELINE_LAYERS } from "./layers";

const CLOSE_GAP_TOOLTIP = "間を詰める";

// Renders a "close gap" button centered in each empty span of a track. The
// button stays invisible and click-through until the row is hovered
// (group-hover/track on TimelineTrackContent), so only deliberate clicks on the
// small icon close a gap — clicks elsewhere in the row fall through untouched.
export function TrackGapAffordances({
	track,
	zoomLevel,
}: {
	track: TimelineTrack;
	zoomLevel: number;
}) {
	const editor = useEditor();
	const gaps = useMemo(() => findTrackGaps({ track }), [track]);

	if (gaps.length === 0) {
		return null;
	}

	return (
		<>
			{gaps.map((gap) => {
				const gapLeftPx = timelineTimeToPixels({
					time: gap.startTime,
					zoomLevel,
				});
				const gapWidthPx = timelineTimeToPixels({
					time: gap.duration,
					zoomLevel,
				});
				const centerPx = gapLeftPx + gapWidthPx / 2;

				return (
					<Tooltip key={`${gap.startTime}-${gap.duration}`}>
						<TooltipTrigger asChild>
							<button
								type="button"
								aria-label={CLOSE_GAP_TOOLTIP}
								className="bg-primary text-primary-foreground ring-background pointer-events-none absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full opacity-0 shadow-md ring-2 transition-opacity group-hover/track:pointer-events-auto group-hover/track:opacity-100"
								style={{
									left: `${centerPx}px`,
									zIndex: TIMELINE_LAYERS.gapAffordance,
								}}
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									editor.timeline.closeGap({
										trackId: track.id,
										gapStartTime: gap.startTime,
										gapDuration: gap.duration,
									});
								}}
							>
								<OcRippleIcon size={16} />
							</button>
						</TooltipTrigger>
						<TooltipContent>{CLOSE_GAP_TOOLTIP}</TooltipContent>
					</Tooltip>
				);
			})}
		</>
	);
}
