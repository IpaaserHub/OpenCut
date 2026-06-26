import type { PointerEvent as ReactPointerEvent } from "react";
import type { MediaAsset } from "@/media/types";
import {
	getVisibleElementsWithBounds,
	type Corner,
	type Edge,
	type ElementBounds,
	type ElementWithBounds,
} from "@/preview/element-bounds";
import {
	MIN_SCALE,
	SNAP_THRESHOLD_SCREEN_PIXELS,
	snapRotation,
	snapScaleAxes,
	type ScaleEdgePreference,
	type SnapLine,
} from "@/preview/preview-snap";
import { isVisualElement } from "@/timeline/element-utils";
import {
	getElementLocalTime,
	hasKeyframesForPath,
	setChannel,
} from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import type { ParamValues } from "@/params";
import { buildTransformFromParams, type Transform } from "@/rendering";
import { resolveTransformAtTime } from "@/rendering/animation-values";
import type {
	ElementRef,
	SceneTracks,
	TimelineElement,
	VisualElement,
} from "@/timeline";

type Point = { readonly x: number; readonly y: number };
type CanvasSize = { readonly width: number; readonly height: number };
type HandleType = Corner | Edge | "rotation";

interface CapturedPointerState {
	readonly pointerId: number;
	readonly captureTarget: HTMLElement;
}

interface CornerScaleSession extends CapturedPointerState {
	readonly kind: "corner-scale";
	readonly corner: Corner;
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
	readonly baseWidth: number;
	readonly baseHeight: number;
	readonly rotationRad: number;
	readonly shouldClearScaleAnimation: boolean;
	readonly animationsWithoutScale: ElementAnimations | undefined;
}

interface EdgeScaleSession extends CapturedPointerState {
	readonly kind: "edge-scale";
	readonly edge: Edge;
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
	readonly baseWidth: number;
	readonly baseHeight: number;
	readonly rotationRad: number;
	readonly shouldClearScaleAnimation: boolean;
	readonly animationsWithoutScale: ElementAnimations | undefined;
}

interface RotationSession extends CapturedPointerState {
	readonly kind: "rotation";
	readonly trackId: string;
	readonly elementId: string;
	readonly initialTransform: Transform;
	readonly initialParams: ParamValues;
	readonly initialAngle: number;
	readonly initialBoundsCx: number;
	readonly initialBoundsCy: number;
}

type TransformSession =
	| { readonly kind: "idle" }
	| CornerScaleSession
	| EdgeScaleSession
	| RotationSession;

const IDLE_SESSION: TransformSession = { kind: "idle" };

interface VisualSelectionContext {
	readonly trackId: string;
	readonly elementId: string;
	readonly element: VisualElement;
	readonly bounds: ElementBounds;
	readonly resolvedTransform: Transform;
}

export interface PreviewViewportAdapter {
	screenToCanvas: ({
		clientX,
		clientY,
	}: {
		clientX: number;
		clientY: number;
	}) => Point | null;
	screenPixelsToLogicalThreshold: ({
		screenPixels,
	}: {
		screenPixels: number;
	}) => Point;
}

export interface InputAdapter {
	isShiftHeld: () => boolean;
}

export interface SceneReader {
	getSelectedElements: () => readonly ElementRef[];
	getTracks: () => SceneTracks;
	getCurrentTime: () => number;
	getMediaAssets: () => MediaAsset[];
	getCanvasSize: () => CanvasSize;
}

export interface TimelinePreviewUpdate {
	readonly trackId: string;
	readonly elementId: string;
	readonly updates: Partial<TimelineElement>;
}

export interface TimelineOps {
	previewElements: (updates: readonly TimelinePreviewUpdate[]) => void;
	commitPreview: () => void;
	discardPreview: () => void;
}

export interface PreviewOptions {
	onSnapLinesChange?: (lines: SnapLine[]) => void;
}

export interface TransformHandleDeps {
	viewport: PreviewViewportAdapter;
	input: InputAdapter;
	scene: SceneReader;
	timeline: TimelineOps;
	preview: PreviewOptions;
}

export interface TransformHandleDepsRef {
	readonly current: TransformHandleDeps;
}

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
	session: EdgeScaleSession;
	scale: number;
}): Point {
	const sign = getEdgeSign(session.edge);
	const horizontal = isHorizontalEdge(session.edge);
	const baseSize = horizontal ? session.baseWidth : session.baseHeight;
	const initialScale = horizontal
		? session.initialTransform.scaleX
		: session.initialTransform.scaleY;
	const localCenterOffset = (sign * baseSize * (scale - initialScale)) / 2;
	const cos = Math.cos(session.rotationRad);
	const sin = Math.sin(session.rotationRad);

	return {
		x:
			session.initialTransform.position.x +
			(horizontal ? localCenterOffset * cos : -localCenterOffset * sin),
		y:
			session.initialTransform.position.y +
			(horizontal ? localCenterOffset * sin : localCenterOffset * cos),
	};
}

function getAabbEdgesForEdgeScale({
	session,
	scale,
	position,
}: {
	session: EdgeScaleSession;
	scale: number;
	position: Point;
}): Record<"left" | "right" | "top" | "bottom", number> {
	const horizontal = isHorizontalEdge(session.edge);
	const scaleX = horizontal ? scale : session.initialTransform.scaleX;
	const scaleY = horizontal ? session.initialTransform.scaleY : scale;
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
	session: EdgeScaleSession;
	proposedScale: number;
	canvasSize: CanvasSize;
	snapThreshold: Point;
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

function buildSelectedWithBounds({
	selectedElements,
	elementsWithBounds,
}: {
	selectedElements: readonly ElementRef[];
	elementsWithBounds: readonly ElementWithBounds[];
}): ElementWithBounds | null {
	if (selectedElements.length !== 1) return null;

	return (
		elementsWithBounds.find(
			(entry) =>
				entry.trackId === selectedElements[0].trackId &&
				entry.elementId === selectedElements[0].elementId,
		) ?? null
	);
}

function buildCornerScaleAnimationReset({
	animations,
}: {
	animations: ElementAnimations | undefined;
}): {
	shouldClearScaleAnimation: boolean;
	animationsWithoutScale: ElementAnimations | undefined;
} {
	const shouldClearScaleAnimation =
		hasKeyframesForPath({
			animations,
			propertyPath: "transform.scaleX",
		}) ||
		hasKeyframesForPath({
			animations,
			propertyPath: "transform.scaleY",
		});

	return {
		shouldClearScaleAnimation,
		animationsWithoutScale: shouldClearScaleAnimation
			? setChannel({
					animations: setChannel({
						animations,
						propertyPath: "transform.scaleX",
						channel: undefined,
					}),
					propertyPath: "transform.scaleY",
					channel: undefined,
				})
			: animations,
	};
}

function buildEdgeScaleAnimationReset({
	animations,
	edge,
}: {
	animations: ElementAnimations | undefined;
	edge: Edge;
}): {
	shouldClearScaleAnimation: boolean;
	animationsWithoutScale: ElementAnimations | undefined;
} {
	const propertyPath =
		edge === "right" || edge === "left"
			? "transform.scaleX"
			: "transform.scaleY";

	const shouldClearScaleAnimation = hasKeyframesForPath({
		animations,
		propertyPath,
	});

	return {
		shouldClearScaleAnimation,
		animationsWithoutScale: shouldClearScaleAnimation
			? setChannel({
					animations,
					propertyPath,
					channel: undefined,
				})
			: animations,
	};
}

export class TransformHandleController {
	private readonly depsRef: TransformHandleDepsRef;
	private readonly subscribers = new Set<() => void>();

	private session: TransformSession = IDLE_SESSION;

	constructor({ depsRef }: { depsRef: TransformHandleDepsRef }) {
		this.depsRef = depsRef;

		this.onCornerPointerDown = this.onCornerPointerDown.bind(this);
		this.onEdgePointerDown = this.onEdgePointerDown.bind(this);
		this.onRotationPointerDown = this.onRotationPointerDown.bind(this);
		this.onPointerMove = this.onPointerMove.bind(this);
		this.onPointerUp = this.onPointerUp.bind(this);
	}

	private get deps(): TransformHandleDeps {
		return this.depsRef.current;
	}

	get selectedWithBounds(): ElementWithBounds | null {
		return buildSelectedWithBounds({
			selectedElements: this.deps.scene.getSelectedElements(),
			elementsWithBounds: this.getVisibleElementsWithBounds(),
		});
	}

	get activeHandle(): HandleType | null {
		switch (this.session.kind) {
			case "corner-scale":
				return this.session.corner;
			case "edge-scale":
				return this.session.edge;
			case "rotation":
				return "rotation";
			default:
				return null;
		}
	}

	get isActive(): boolean {
		return this.session.kind !== "idle";
	}

	subscribe(fn: () => void): () => void {
		this.subscribers.add(fn);
		return () => this.subscribers.delete(fn);
	}

	destroy(): void {
		if (this.session.kind !== "idle") {
			const session = this.session;
			this.session = IDLE_SESSION;
			this.deps.timeline.discardPreview();
			this.clearSnapLines();
			this.releaseCapturedPointer(session);
		}

		this.subscribers.clear();
	}

	cancel(): void {
		if (this.session.kind === "idle") return;

		const session = this.session;
		this.session = IDLE_SESSION;
		this.deps.timeline.discardPreview();
		this.clearSnapLines();
		this.releaseCapturedPointer(session);
		this.notify();
	}

	onCornerPointerDown({
		event,
		corner,
	}: {
		event: ReactPointerEvent;
		corner: Corner;
	}): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();
		if (!(event.currentTarget instanceof HTMLElement)) return;

		const { shouldClearScaleAnimation, animationsWithoutScale } =
			buildCornerScaleAnimationReset({
				animations: context.element.animations,
			});

		this.session = {
			kind: "corner-scale",
			corner,
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			baseWidth: context.bounds.width / context.resolvedTransform.scaleX,
			baseHeight: context.bounds.height / context.resolvedTransform.scaleY,
			rotationRad: (context.bounds.rotation * Math.PI) / 180,
			shouldClearScaleAnimation,
			animationsWithoutScale,
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onRotationPointerDown({ event }: { event: ReactPointerEvent }): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();
		if (!(event.currentTarget instanceof HTMLElement)) return;

		const position = this.deps.viewport.screenToCanvas({
			clientX: event.clientX,
			clientY: event.clientY,
		});
		if (!position) return;

		const deltaX = position.x - context.bounds.cx;
		const deltaY = position.y - context.bounds.cy;
		const initialAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

		this.session = {
			kind: "rotation",
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialAngle,
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onEdgePointerDown({
		event,
		edge,
	}: {
		event: ReactPointerEvent;
		edge: Edge;
	}): void {
		const context = this.getSelectedVisualContext();
		if (!context) return;

		event.stopPropagation();
		if (!(event.currentTarget instanceof HTMLElement)) return;

		const { shouldClearScaleAnimation, animationsWithoutScale } =
			buildEdgeScaleAnimationReset({
				animations: context.element.animations,
				edge,
			});

		this.session = {
			kind: "edge-scale",
			edge,
			trackId: context.trackId,
			elementId: context.elementId,
			initialTransform: context.resolvedTransform,
			initialParams: context.element.params,
			initialBoundsCx: context.bounds.cx,
			initialBoundsCy: context.bounds.cy,
			baseWidth: context.bounds.width / context.resolvedTransform.scaleX,
			baseHeight: context.bounds.height / context.resolvedTransform.scaleY,
			rotationRad: (context.bounds.rotation * Math.PI) / 180,
			shouldClearScaleAnimation,
			animationsWithoutScale,
			pointerId: event.pointerId,
			captureTarget: this.capturePointer({
				target: event.currentTarget,
				pointerId: event.pointerId,
			}),
		};

		this.notify();
	}

	onPointerMove({ event }: { event: ReactPointerEvent }): void {
		if (this.session.kind === "idle") return;

		const position = this.deps.viewport.screenToCanvas({
			clientX: event.clientX,
			clientY: event.clientY,
		});
		if (!position) return;

		switch (this.session.kind) {
			case "corner-scale":
				this.previewCornerScale({
					session: this.session,
					position,
				});
				return;
			case "edge-scale":
				this.previewEdgeScale({
					session: this.session,
					position,
				});
				return;
			case "rotation":
				this.previewRotation({
					session: this.session,
					position,
				});
				return;
			default:
				return;
		}
	}

	onPointerUp(): void {
		if (this.session.kind === "idle") return;

		const session = this.session;
		this.session = IDLE_SESSION;
		this.deps.timeline.commitPreview();
		this.clearSnapLines();
		this.releaseCapturedPointer(session);
		this.notify();
	}

	private notify(): void {
		for (const fn of this.subscribers) fn();
	}

	private clearSnapLines(): void {
		this.deps.preview.onSnapLinesChange?.([]);
	}

	private capturePointer({
		target,
		pointerId,
	}: {
		target: HTMLElement;
		pointerId: number;
	}): HTMLElement {
		target.setPointerCapture(pointerId);
		return target;
	}

	private releaseCapturedPointer(pointerState: CapturedPointerState): void {
		if (!pointerState.captureTarget.hasPointerCapture(pointerState.pointerId)) {
			return;
		}

		pointerState.captureTarget.releasePointerCapture(pointerState.pointerId);
	}

	private getVisibleElementsWithBounds(): ElementWithBounds[] {
		return getVisibleElementsWithBounds({
			tracks: this.deps.scene.getTracks(),
			currentTime: this.deps.scene.getCurrentTime(),
			canvasSize: this.deps.scene.getCanvasSize(),
			mediaAssets: this.deps.scene.getMediaAssets(),
		});
	}

	private getSelectedVisualContext(): VisualSelectionContext | null {
		const selectedWithBounds = this.selectedWithBounds;
		if (!selectedWithBounds) return null;
		if (!isVisualElement(selectedWithBounds.element)) return null;

		const localTime = getElementLocalTime({
			timelineTime: this.deps.scene.getCurrentTime(),
			elementStartTime: selectedWithBounds.element.startTime,
			elementDuration: selectedWithBounds.element.duration,
		});

		return {
			trackId: selectedWithBounds.trackId,
			elementId: selectedWithBounds.elementId,
			element: selectedWithBounds.element,
			bounds: selectedWithBounds.bounds,
			resolvedTransform: resolveTransformAtTime({
				baseTransform: buildTransformFromParams({
					params: selectedWithBounds.element.params,
				}),
				animations: selectedWithBounds.element.animations,
				localTime,
			}),
		};
	}

	private previewCornerScale({
		session,
		position,
	}: {
		session: CornerScaleSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const xProjection =
			deltaX * Math.cos(session.rotationRad) +
			deltaY * Math.sin(session.rotationRad);
		const yProjection =
			-deltaX * Math.sin(session.rotationRad) +
			deltaY * Math.cos(session.rotationRad);
		const xSign =
			session.corner === "top-left" || session.corner === "bottom-left"
				? -1
				: 1;
		const ySign =
			session.corner === "top-left" || session.corner === "top-right" ? -1 : 1;
		const proposedScaleX = clampScaleNonZero(
			(xProjection * xSign) / (session.baseWidth / 2 || 1),
		);
		const proposedScaleY = clampScaleNonZero(
			(yProjection * ySign) / (session.baseHeight / 2 || 1),
		);

		const snapThreshold = this.deps.viewport.screenPixelsToLogicalThreshold({
			screenPixels: SNAP_THRESHOLD_SCREEN_PIXELS,
		});
		const { x: xSnap, y: ySnap } = this.deps.input.isShiftHeld()
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
					position: session.initialTransform.position,
					baseWidth: session.baseWidth,
					baseHeight: session.baseHeight,
					rotation: session.initialTransform.rotate,
					canvasSize: this.deps.scene.getCanvasSize(),
					snapThreshold,
					preferredEdges: getPreferredCornerEdges({
						corner: session.corner,
					}),
				});

		this.deps.preview.onSnapLinesChange?.([
			...xSnap.activeLines,
			...ySnap.activeLines,
		]);

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							scaleX: xSnap.snappedScale,
							scaleY: ySnap.snappedScale,
						},
					}),
					...(session.shouldClearScaleAnimation && {
						animations: session.animationsWithoutScale,
					}),
				},
			},
		]);
	}

	private previewEdgeScale({
		session,
		position,
	}: {
		session: EdgeScaleSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const xProjection =
			deltaX * Math.cos(session.rotationRad) +
			deltaY * Math.sin(session.rotationRad);
		const yProjection =
			-deltaX * Math.sin(session.rotationRad) +
			deltaY * Math.cos(session.rotationRad);
		const horizontal = isHorizontalEdge(session.edge);
		const edgeSign = getEdgeSign(session.edge);
		const axisProjection = horizontal ? xProjection : yProjection;
		const baseAxisSize = horizontal ? session.baseWidth : session.baseHeight;
		const initialScale = horizontal
			? session.initialTransform.scaleX
			: session.initialTransform.scaleY;
		const shouldResizeFromCenter = this.deps.input.isShiftHeld();
		const proposedScale = clampScaleNonZero(
			shouldResizeFromCenter
				? (edgeSign * axisProjection) / (baseAxisSize / 2 || 1)
				: (edgeSign *
						(axisProjection + (edgeSign * baseAxisSize * initialScale) / 2)) /
						baseAxisSize,
		);

		const proposedScaleX = horizontal
			? proposedScale
			: session.initialTransform.scaleX;
		const proposedScaleY = horizontal
			? session.initialTransform.scaleY
			: proposedScale;

		const snapThreshold = this.deps.viewport.screenPixelsToLogicalThreshold({
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
						canvasSize: this.deps.scene.getCanvasSize(),
						snapThreshold,
					});
					return {
						x: {
							snappedScale: horizontal
								? snap.snappedScale
								: session.initialTransform.scaleX,
							snapDistance: Infinity,
							activeLines: horizontal ? snap.activeLines : [],
						},
						y: {
							snappedScale: horizontal
								? session.initialTransform.scaleY
								: snap.snappedScale,
							snapDistance: Infinity,
							activeLines: horizontal ? [] : snap.activeLines,
						},
					};
				})();

		const relevantSnap = horizontal ? xSnap : ySnap;
		this.deps.preview.onSnapLinesChange?.(relevantSnap.activeLines);
		const finalScale = horizontal ? xSnap.snappedScale : ySnap.snappedScale;
		const finalPosition = shouldResizeFromCenter
			? session.initialTransform.position
			: getAnchoredEdgePosition({ session, scale: finalScale });

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							position: finalPosition,
							scaleX: horizontal
								? xSnap.snappedScale
								: session.initialTransform.scaleX,
							scaleY: horizontal
								? session.initialTransform.scaleY
								: ySnap.snappedScale,
						},
					}),
					...(session.shouldClearScaleAnimation && {
						animations: session.animationsWithoutScale,
					}),
				},
			},
		]);
	}

	private previewRotation({
		session,
		position,
	}: {
		session: RotationSession;
		position: Point;
	}): void {
		const deltaX = position.x - session.initialBoundsCx;
		const deltaY = position.y - session.initialBoundsCy;
		const currentAngle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
		let deltaAngle = currentAngle - session.initialAngle;
		if (deltaAngle > 180) deltaAngle -= 360;
		if (deltaAngle < -180) deltaAngle += 360;

		const newRotate = session.initialTransform.rotate + deltaAngle;
		const { snappedRotation } = this.deps.input.isShiftHeld()
			? { snappedRotation: newRotate }
			: snapRotation({ proposedRotation: newRotate });

		this.deps.timeline.previewElements([
			{
				trackId: session.trackId,
				elementId: session.elementId,
				updates: {
					params: buildParamsWithTransform({
						params: session.initialParams,
						transform: {
							...session.initialTransform,
							rotate: snappedRotation,
						},
					}),
				},
			},
		]);
	}
}

function buildParamsWithTransform({
	params,
	transform,
}: {
	params: ParamValues;
	transform: Transform;
}): ParamValues {
	return {
		...params,
		"transform.positionX": transform.position.x,
		"transform.positionY": transform.position.y,
		"transform.scaleX": transform.scaleX,
		"transform.scaleY": transform.scaleY,
		"transform.rotate": transform.rotate,
	};
}
