import { useCallback, useEffect, useRef, useState } from "react";
import { usePreviewViewport } from "@/components/editor/panels/preview/preview-viewport";
import type { OnSnapLinesChange } from "@/hooks/use-preview-interaction";
import { useEditor } from "@/hooks/use-editor";
import { useShiftKey } from "@/hooks/use-shift-key";
import {
	getVisibleElementsWithBounds,
	type ElementWithBounds,
} from "@/lib/preview/element-bounds";
import {
	MIN_SCALE,
	SNAP_THRESHOLD_SCREEN_PIXELS,
	snapRotation,
	snapScaleAxes,
	type ScaleEdgePreference,
	type SnapLine,
} from "@/lib/preview/preview-snap";
import { isVisualElement } from "@/lib/timeline/element-utils";
import {
	getElementLocalTime,
	resolveTransformAtTime,
	setChannel,
} from "@/lib/animation";
import type { Transform } from "@/lib/rendering";
import type { ElementAnimations } from "@/lib/animation/types";
import { registerCanceller } from "@/lib/cancel-interaction";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Edge = "right" | "left" | "top" | "bottom";
type HandleType = Corner | Edge | "rotation";

function getPreferredEdge({ edge }: { edge: Edge }): ScaleEdgePreference {
	return edge === "right"
		? { right: true }
		: edge === "left"
			? { left: true }
			: edge === "top"
				? { top: true }
				: { bottom: true };
}

function getPreferredCornerEdges({
	corner,
}: {
	corner: Corner;
}): ScaleEdgePreference {
	return {
		left: corner === "top-left" || corner === "bottom-left",
		right: corner === "top-right" || corner === "bottom-right",
		top: corner === "top-left" || corner === "top-right",
		bottom: corner === "bottom-left" || corner === "bottom-right",
	};
}

interface ScaleState {
	trackId: string;
	elementId: string;
	corner: Corner;
	initialTransform: Transform;
	initialBoundsCx: number;
	initialBoundsCy: number;
	baseWidth: number;
	baseHeight: number;
	rotationRad: number;
	shouldClearScaleAnimation: boolean;
	animationsWithoutScale: ElementAnimations | undefined;
}

interface RotationState {
	trackId: string;
	elementId: string;
	initialTransform: Transform;
	initialAngle: number;
	initialBoundsCx: number;
	initialBoundsCy: number;
}

interface EdgeScaleState {
	trackId: string;
	elementId: string;
	initialTransform: Transform;
	initialBoundsCx: number;
	initialBoundsCy: number;
	baseWidth: number;
	baseHeight: number;
	edge: Edge;
	rotationRad: number;
	shouldClearScaleAnimation: boolean;
	animationsWithoutScale: ElementAnimations | undefined;
}

function clampScaleNonZero(scale: number): number {
	if (Math.abs(scale) < MIN_SCALE) {
		return scale < 0 ? -MIN_SCALE : MIN_SCALE;
	}
	return scale;
}

function isHorizontalEdge(edge: Edge): boolean {
	return edge === "right" || edge === "left";
}

function getEdgeSign(edge: Edge): 1 | -1 {
	return edge === "right" || edge === "bottom" ? 1 : -1;
}

function getAnchoredEdgePosition({
	session,
	scale,
}: {
	session: EdgeScaleState;
	scale: number;
}): { x: number; y: number } {
	const sign = getEdgeSign(session.edge);
	const isHorizontal = isHorizontalEdge(session.edge);
	const baseSize = isHorizontal ? session.baseWidth : session.baseHeight;
	const initialScale = isHorizontal
		? session.initialTransform.scaleX
		: session.initialTransform.scaleY;
	const localCenterOffset = (sign * baseSize * (scale - initialScale)) / 2;
	const cos = Math.cos(session.rotationRad);
	const sin = Math.sin(session.rotationRad);

	return {
		x:
			session.initialTransform.position.x +
			(isHorizontal ? localCenterOffset * cos : -localCenterOffset * sin),
		y:
			session.initialTransform.position.y +
			(isHorizontal ? localCenterOffset * sin : localCenterOffset * cos),
	};
}

function getAabbEdgesForEdgeScale({
	session,
	scale,
	position,
}: {
	session: EdgeScaleState;
	scale: number;
	position: { x: number; y: number };
}): Record<"left" | "right" | "top" | "bottom", number> {
	const isHorizontal = isHorizontalEdge(session.edge);
	const scaleX = isHorizontal ? scale : session.initialTransform.scaleX;
	const scaleY = isHorizontal ? session.initialTransform.scaleY : scale;
	const cosR = Math.abs(Math.cos(session.rotationRad));
	const sinR = Math.abs(Math.sin(session.rotationRad));
	const halfWidth =
		(session.baseWidth * scaleX * cosR + session.baseHeight * scaleY * sinR) /
		2;
	const halfHeight =
		(session.baseWidth * scaleX * sinR + session.baseHeight * scaleY * cosR) /
		2;

	return {
		left: position.x - halfWidth,
		right: position.x + halfWidth,
		top: position.y - halfHeight,
		bottom: position.y + halfHeight,
	};
}

function snapAnchoredEdgeScale({
	session,
	proposedScale,
	canvasSize,
	snapThreshold,
}: {
	session: EdgeScaleState;
	proposedScale: number;
	canvasSize: { width: number; height: number };
	snapThreshold: { x: number; y: number };
}): { snappedScale: number; activeLines: SnapLine[] } {
	type ScaleEdge = "left" | "right" | "top" | "bottom";
	type Candidate = {
		scale: number;
		distance: number;
		line: SnapLine;
		edge: ScaleEdge;
	};

	const preferredEdges = getPreferredEdge({ edge: session.edge });
	const currentEdges = getAabbEdgesForEdgeScale({
		session,
		scale: proposedScale,
		position: getAnchoredEdgePosition({ session, scale: proposedScale }),
	});

	function edgeAtScale({ scale, edge }: { scale: number; edge: ScaleEdge }) {
		return getAabbEdgesForEdgeScale({
			session,
			scale,
			position: getAnchoredEdgePosition({ session, scale }),
		})[edge];
	}

	function solveScale({
		edge,
		target,
	}: {
		edge: ScaleEdge;
		target: number;
	}): number | null {
		const edgeAtZero = edgeAtScale({ scale: 0, edge });
		const edgeAtOne = edgeAtScale({ scale: 1, edge });
		const slope = edgeAtOne - edgeAtZero;
		if (Math.abs(slope) < 1e-6) return null;
		return clampScaleNonZero((target - edgeAtZero) / slope);
	}

	const candidates: Candidate[] = [];
	const addCandidate = ({
		edge,
		target,
		line,
		threshold,
	}: {
		edge: ScaleEdge;
		target: number;
		line: SnapLine;
		threshold: number;
	}) => {
		const distance = Math.abs(currentEdges[edge] - target);
		if (distance > threshold) return;
		const scale = solveScale({ edge, target });
		if (scale === null || Math.abs(scale) <= MIN_SCALE) return;
		candidates.push({ scale, distance, line, edge });
	};

	for (const target of [-canvasSize.width / 2, 0, canvasSize.width / 2]) {
		const line: SnapLine = { type: "vertical", position: target };
		addCandidate({ edge: "left", target, line, threshold: snapThreshold.x });
		addCandidate({ edge: "right", target, line, threshold: snapThreshold.x });
	}

	for (const target of [-canvasSize.height / 2, 0, canvasSize.height / 2]) {
		const line: SnapLine = { type: "horizontal", position: target };
		addCandidate({ edge: "top", target, line, threshold: snapThreshold.y });
		addCandidate({ edge: "bottom", target, line, threshold: snapThreshold.y });
	}

	const best = candidates.reduce<Candidate | null>(
		(bestCandidate, candidate) => {
			if (!bestCandidate) return candidate;
			if (candidate.distance < bestCandidate.distance) return candidate;
			if (candidate.distance > bestCandidate.distance) return bestCandidate;
			const shouldPreferCandidate = preferredEdges[candidate.edge] === true;
			const shouldPreferBest = preferredEdges[bestCandidate.edge] === true;
			return shouldPreferCandidate && !shouldPreferBest
				? candidate
				: bestCandidate;
		},
		null,
	);

	if (!best) {
		return { snappedScale: proposedScale, activeLines: [] };
	}

	return {
		snappedScale: best.scale,
		activeLines: [best.line],
	};
}

export function useTransformHandles({
	onSnapLinesChange,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
}) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	const viewport = usePreviewViewport();
	const [activeHandle, setActiveHandle] = useState<HandleType | null>(null);
	const scaleStateRef = useRef<ScaleState | null>(null);
	const rotationStateRef = useRef<RotationState | null>(null);
	const edgeScaleStateRef = useRef<EdgeScaleState | null>(null);
	const captureRef = useRef<{ element: HTMLElement; pointerId: number } | null>(
		null,
	);

	const selectedElements = useEditor((e) => e.selection.getSelectedElements());
	const tracks = useEditor((e) => e.timeline.getRenderTracks());
	const currentTime = useEditor((e) => e.playback.getCurrentTime());
	const currentTimeRef = useRef(currentTime);
	currentTimeRef.current = currentTime;
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const canvasSize = useEditor(
		(e) => e.project.getActive().settings.canvasSize,
	);

	const elementsWithBounds = getVisibleElementsWithBounds({
		tracks,
		currentTime,
		canvasSize,
		mediaAssets,
	});

	const selectedWithBounds: ElementWithBounds | null =
		selectedElements.length === 1
			? (elementsWithBounds.find(
					(entry) =>
						entry.trackId === selectedElements[0].trackId &&
						entry.elementId === selectedElements[0].elementId,
				) ?? null)
			: null;

	const hasVisualSelection =
		selectedWithBounds !== null && isVisualElement(selectedWithBounds.element);

	const clearActiveHandleState = useCallback(() => {
		scaleStateRef.current = null;
		rotationStateRef.current = null;
		edgeScaleStateRef.current = null;
		setActiveHandle(null);
		onSnapLinesChange?.([]);
	}, [onSnapLinesChange]);

	const releaseCapturedPointer = useCallback(() => {
		const capture = captureRef.current;
		if (!capture) return;

		if (capture.element.hasPointerCapture(capture.pointerId)) {
			capture.element.releasePointerCapture(capture.pointerId);
		}

		captureRef.current = null;
	}, []);

	useEffect(() => {
		if (!activeHandle) return;

		return registerCanceller({
			fn: () => {
				editor.timeline.discardPreview();
				clearActiveHandleState();
				releaseCapturedPointer();
			},
		});
	}, [
		activeHandle,
		clearActiveHandleState,
		editor.timeline,
		releaseCapturedPointer,
	]);

	const handleCornerPointerDown = useCallback(
		({ event, corner }: { event: React.PointerEvent; corner: Corner }) => {
			if (!selectedWithBounds) return;
			event.stopPropagation();

			const { bounds, trackId, elementId, element } = selectedWithBounds;
			if (!isVisualElement(element)) return;

			const localTime = getElementLocalTime({
				timelineTime: currentTimeRef.current,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});
			const resolvedTransform = resolveTransformAtTime({
				baseTransform: element.transform,
				animations: element.animations,
				localTime,
			});

			const baseWidth = bounds.width / resolvedTransform.scaleX;
			const baseHeight = bounds.height / resolvedTransform.scaleY;
			const rotationRad = (bounds.rotation * Math.PI) / 180;
			const shouldClearScaleAnimation =
				!!element.animations?.channels["transform.scaleX"] ||
				!!element.animations?.channels["transform.scaleY"];
			const animationsWithoutScale = shouldClearScaleAnimation
				? setChannel({
						animations: setChannel({
							animations: element.animations,
							propertyPath: "transform.scaleX",
							channel: undefined,
						}),
						propertyPath: "transform.scaleY",
						channel: undefined,
					})
				: element.animations;

			scaleStateRef.current = {
				trackId,
				elementId,
				corner,
				initialTransform: resolvedTransform,
				initialBoundsCx: bounds.cx,
				initialBoundsCy: bounds.cy,
				baseWidth,
				baseHeight,
				rotationRad,
				shouldClearScaleAnimation,
				animationsWithoutScale,
			};
			setActiveHandle(corner);
			const captureTarget = event.currentTarget as HTMLElement;
			captureTarget.setPointerCapture(event.pointerId);
			captureRef.current = {
				element: captureTarget,
				pointerId: event.pointerId,
			};
		},
		[selectedWithBounds],
	);

	const handleRotationPointerDown = useCallback(
		({ event }: { event: React.PointerEvent }) => {
			if (!selectedWithBounds) return;
			event.stopPropagation();

			const { bounds, trackId, elementId, element } = selectedWithBounds;
			if (!isVisualElement(element)) return;

			const localTime = getElementLocalTime({
				timelineTime: currentTimeRef.current,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});
			const resolvedTransform = resolveTransformAtTime({
				baseTransform: element.transform,
				animations: element.animations,
				localTime,
			});

			const position = viewport.screenToCanvas({
				clientX: event.clientX,
				clientY: event.clientY,
			});
			if (!position) return;
			const deltaX = position.x - bounds.cx;
			const deltaY = position.y - bounds.cy;
			const initialAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

			rotationStateRef.current = {
				trackId,
				elementId,
				initialTransform: resolvedTransform,
				initialAngle,
				initialBoundsCx: bounds.cx,
				initialBoundsCy: bounds.cy,
			};
			setActiveHandle("rotation");
			const captureTarget = event.currentTarget as HTMLElement;
			captureTarget.setPointerCapture(event.pointerId);
			captureRef.current = {
				element: captureTarget,
				pointerId: event.pointerId,
			};
		},
		[selectedWithBounds, viewport],
	);

	const handleEdgePointerDown = useCallback(
		({ event, edge }: { event: React.PointerEvent; edge: Edge }) => {
			if (!selectedWithBounds) return;
			event.stopPropagation();

			const { bounds, trackId, elementId, element } = selectedWithBounds;
			if (!isVisualElement(element)) return;

			const localTime = getElementLocalTime({
				timelineTime: currentTimeRef.current,
				elementStartTime: element.startTime,
				elementDuration: element.duration,
			});
			const resolvedTransform = resolveTransformAtTime({
				baseTransform: element.transform,
				animations: element.animations,
				localTime,
			});

			const baseWidth = bounds.width / resolvedTransform.scaleX;
			const baseHeight = bounds.height / resolvedTransform.scaleY;
			const rotationRad = (bounds.rotation * Math.PI) / 180;

			const propertyPath =
				edge === "right" || edge === "left"
					? "transform.scaleX"
					: "transform.scaleY";
			const shouldClearScaleAnimation =
				!!element.animations?.channels[propertyPath];
			const animationsWithoutScale = shouldClearScaleAnimation
				? setChannel({
						animations: element.animations,
						propertyPath,
						channel: undefined,
					})
				: element.animations;

			edgeScaleStateRef.current = {
				trackId,
				elementId,
				initialTransform: resolvedTransform,
				initialBoundsCx: bounds.cx,
				initialBoundsCy: bounds.cy,
				baseWidth,
				baseHeight,
				edge,
				rotationRad,
				shouldClearScaleAnimation,
				animationsWithoutScale,
			};
			setActiveHandle(edge);
			const captureTarget = event.currentTarget as HTMLElement;
			captureTarget.setPointerCapture(event.pointerId);
			captureRef.current = {
				element: captureTarget,
				pointerId: event.pointerId,
			};
		},
		[selectedWithBounds],
	);

	const handlePointerMove = useCallback(
		({ event }: { event: React.PointerEvent }) => {
			if (
				!scaleStateRef.current &&
				!rotationStateRef.current &&
				!edgeScaleStateRef.current
			)
				return;

			const position = viewport.screenToCanvas({
				clientX: event.clientX,
				clientY: event.clientY,
			});
			if (!position) return;

			if (
				scaleStateRef.current &&
				activeHandle &&
				activeHandle !== "rotation"
			) {
				const {
					trackId,
					elementId,
					initialTransform,
					initialBoundsCx,
					initialBoundsCy,
					baseWidth,
					baseHeight,
					corner,
					rotationRad,
					shouldClearScaleAnimation,
					animationsWithoutScale,
				} = scaleStateRef.current;

				const deltaX = position.x - initialBoundsCx;
				const deltaY = position.y - initialBoundsCy;
				const xProjection =
					deltaX * Math.cos(rotationRad) + deltaY * Math.sin(rotationRad);
				const yProjection =
					-deltaX * Math.sin(rotationRad) + deltaY * Math.cos(rotationRad);
				const xSign =
					corner === "top-left" || corner === "bottom-left" ? -1 : 1;
				const ySign = corner === "top-left" || corner === "top-right" ? -1 : 1;
				const proposedScaleX = clampScaleNonZero(
					(xProjection * xSign) / (baseWidth / 2 || 1),
				);
				const proposedScaleY = clampScaleNonZero(
					(yProjection * ySign) / (baseHeight / 2 || 1),
				);

				const snapThreshold = viewport.screenPixelsToLogicalThreshold({
					screenPixels: SNAP_THRESHOLD_SCREEN_PIXELS,
				});
				const { x: xSnap, y: ySnap } = isShiftHeldRef.current
					? {
							x: {
								snappedScale: proposedScaleX,
								snapDistance: Infinity,
								activeLines: [] as SnapLine[],
							},
							y: {
								snappedScale: proposedScaleY,
								snapDistance: Infinity,
								activeLines: [] as SnapLine[],
							},
						}
					: snapScaleAxes({
							proposedScaleX,
							proposedScaleY,
							position: initialTransform.position,
							baseWidth,
							baseHeight,
							rotation: initialTransform.rotate,
							canvasSize,
							snapThreshold,
							preferredEdges: getPreferredCornerEdges({ corner }),
						});

				onSnapLinesChange?.([...xSnap.activeLines, ...ySnap.activeLines]);

				editor.timeline.previewElements({
					updates: [
						{
							trackId,
							elementId,
							updates: {
								transform: {
									...initialTransform,
									scaleX: xSnap.snappedScale,
									scaleY: ySnap.snappedScale,
								},
								...(shouldClearScaleAnimation && {
									animations: animationsWithoutScale,
								}),
							},
						},
					],
				});
				return;
			}

			if (
				edgeScaleStateRef.current &&
				(activeHandle === "right" ||
					activeHandle === "left" ||
					activeHandle === "top" ||
					activeHandle === "bottom")
			) {
				const session = edgeScaleStateRef.current;
				const {
					trackId,
					elementId,
					initialTransform,
					initialBoundsCx,
					initialBoundsCy,
					baseWidth,
					baseHeight,
					edge,
					rotationRad,
					shouldClearScaleAnimation,
					animationsWithoutScale,
				} = session;

				const deltaX = position.x - initialBoundsCx;
				const deltaY = position.y - initialBoundsCy;
				const xProjection =
					deltaX * Math.cos(rotationRad) + deltaY * Math.sin(rotationRad);
				const yProjection =
					-deltaX * Math.sin(rotationRad) + deltaY * Math.cos(rotationRad);
				const isHorizontal = isHorizontalEdge(edge);
				const edgeSign = getEdgeSign(edge);
				const axisProjection = isHorizontal ? xProjection : yProjection;
				const baseAxisSize = isHorizontal ? baseWidth : baseHeight;
				const initialScale = isHorizontal
					? initialTransform.scaleX
					: initialTransform.scaleY;
				const shouldResizeFromCenter = isShiftHeldRef.current;
				const proposedScale = clampScaleNonZero(
					shouldResizeFromCenter
						? (edgeSign * axisProjection) / (baseAxisSize / 2 || 1)
						: (edgeSign *
								(axisProjection +
									(edgeSign * baseAxisSize * initialScale) / 2)) /
								baseAxisSize,
				);

				const proposedScaleX = isHorizontal
					? proposedScale
					: initialTransform.scaleX;
				const proposedScaleY = isHorizontal
					? initialTransform.scaleY
					: proposedScale;

				const snapThreshold = viewport.screenPixelsToLogicalThreshold({
					screenPixels: SNAP_THRESHOLD_SCREEN_PIXELS,
				});
				const { x: xSnap, y: ySnap } = shouldResizeFromCenter
					? {
							x: {
								snappedScale: proposedScaleX,
								snapDistance: Infinity,
								activeLines: [] as SnapLine[],
							},
							y: {
								snappedScale: proposedScaleY,
								snapDistance: Infinity,
								activeLines: [] as SnapLine[],
							},
						}
					: (() => {
							const snap = snapAnchoredEdgeScale({
								session,
								proposedScale,
								canvasSize,
								snapThreshold,
							});
							return {
								x: {
									snappedScale: isHorizontal
										? snap.snappedScale
										: initialTransform.scaleX,
									snapDistance: Infinity,
									activeLines: isHorizontal ? snap.activeLines : [],
								},
								y: {
									snappedScale: isHorizontal
										? initialTransform.scaleY
										: snap.snappedScale,
									snapDistance: Infinity,
									activeLines: isHorizontal ? [] : snap.activeLines,
								},
							};
						})();

				const relevantSnap = isHorizontal ? xSnap : ySnap;
				onSnapLinesChange?.(relevantSnap.activeLines);
				const finalScale = isHorizontal
					? xSnap.snappedScale
					: ySnap.snappedScale;
				const finalPosition = shouldResizeFromCenter
					? initialTransform.position
					: getAnchoredEdgePosition({ session, scale: finalScale });

				editor.timeline.previewElements({
					updates: [
						{
							trackId,
							elementId,
							updates: {
								transform: {
									...initialTransform,
									position: finalPosition,
									scaleX: isHorizontal
										? xSnap.snappedScale
										: initialTransform.scaleX,
									scaleY: isHorizontal
										? initialTransform.scaleY
										: ySnap.snappedScale,
								},
								...(shouldClearScaleAnimation && {
									animations: animationsWithoutScale,
								}),
							},
						},
					],
				});
				return;
			}

			if (rotationStateRef.current && activeHandle === "rotation") {
				const {
					trackId,
					elementId,
					initialTransform,
					initialAngle,
					initialBoundsCx,
					initialBoundsCy,
				} = rotationStateRef.current;

				const deltaX = position.x - initialBoundsCx;
				const deltaY = position.y - initialBoundsCy;
				const currentAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
				let deltaAngle = currentAngle - initialAngle;
				if (deltaAngle > 180) deltaAngle -= 360;
				if (deltaAngle < -180) deltaAngle += 360;
				const newRotate = initialTransform.rotate + deltaAngle;
				const { snappedRotation } = isShiftHeldRef.current
					? { snappedRotation: newRotate }
					: snapRotation({ proposedRotation: newRotate });

				editor.timeline.previewElements({
					updates: [
						{
							trackId,
							elementId,
							updates: {
								transform: { ...initialTransform, rotate: snappedRotation },
							},
						},
					],
				});
			}
		},
		[
			activeHandle,
			canvasSize,
			editor,
			isShiftHeldRef,
			onSnapLinesChange,
			viewport,
		],
	);

	const handlePointerUp = useCallback(() => {
		if (
			scaleStateRef.current ||
			rotationStateRef.current ||
			edgeScaleStateRef.current
		) {
			editor.timeline.commitPreview();
			clearActiveHandleState();
		}
		releaseCapturedPointer();
	}, [clearActiveHandleState, editor, releaseCapturedPointer]);

	return {
		selectedWithBounds,
		hasVisualSelection,
		activeHandle,
		handleCornerPointerDown,
		handleEdgePointerDown,
		handleRotationPointerDown,
		handlePointerMove,
		handlePointerUp,
	};
}
