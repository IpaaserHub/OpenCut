"use client";

import { useEffect, useState } from "react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DropTarget, TimelineTrack } from "@/timeline";
import {
	getCenteredLineLeft,
	timelineTimeToPixels,
	TIMELINE_INDICATOR_LINE_WIDTH_PX,
} from "@/timeline";
import { getTotalTracksHeight } from "./track-layout";
import { TIMELINE_CONTENT_TOP_PADDING_PX } from "./layout";
import { TIMELINE_LAYERS } from "./layers";

const RIPPLE_INSERT_HOVER_DELAY_MS = 300;

function getRippleInsertKey({
	dropTarget,
	isVisible,
}: {
	dropTarget: DropTarget | null;
	isVisible: boolean;
}): string | null {
	if (!isVisible || !dropTarget?.rippleInsert) {
		return null;
	}

	return `${dropTarget.trackIndex}:${dropTarget.xPosition}`;
}

export function RippleInsertIndicator({
	dropTarget,
	isVisible,
	zoomLevel,
	scrollLeft,
	tracks,
	headerHeight,
}: {
	dropTarget: DropTarget | null;
	isVisible: boolean;
	zoomLevel: number;
	scrollLeft: number;
	tracks: TimelineTrack[];
	headerHeight: number;
}) {
	const insertKey = getRippleInsertKey({ dropTarget, isVisible });
	const [visibleKey, setVisibleKey] = useState<string | null>(null);

	useEffect(() => {
		if (!insertKey) {
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setVisibleKey(insertKey);
		}, RIPPLE_INSERT_HOVER_DELAY_MS);

		return () => window.clearTimeout(timeoutId);
	}, [insertKey]);

	if (!dropTarget || !insertKey || visibleKey !== insertKey) {
		return null;
	}

	const centerPixel =
		timelineTimeToPixels({
			time: dropTarget.xPosition,
			zoomLevel,
		}) - scrollLeft;
	const height =
		getTotalTracksHeight({ tracks }) + TIMELINE_CONTENT_TOP_PADDING_PX;

	return (
		<div
			className="pointer-events-none absolute"
			aria-hidden="true"
			style={{
				left: `${getCenteredLineLeft({ centerPixel })}px`,
				top: `${headerHeight}px`,
				height: `${height}px`,
				width: `${TIMELINE_INDICATOR_LINE_WIDTH_PX}px`,
				zIndex: TIMELINE_LAYERS.rippleInsertIndicator,
			}}
		>
			<div className="bg-primary h-full w-0.5 opacity-95 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
			<div className="bg-primary text-primary-foreground absolute top-2 left-1/2 flex size-6 -translate-x-1/2 items-center justify-center rounded-full shadow-md ring-2 ring-background">
				<HugeiconsIcon
					icon={PlusSignIcon}
					className="size-4"
					strokeWidth={2.5}
				/>
			</div>
		</div>
	);
}
