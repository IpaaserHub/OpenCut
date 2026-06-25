import type {
	AudioElement,
	AudioTrack,
	EffectElement,
	EffectTrack,
	GraphicElement,
	GraphicTrack,
	ImageElement,
	OverlayTrack,
	SceneTracks,
	StickerElement,
	TextElement,
	TextTrack,
	TimelineElement,
	TimelineTrack,
	VideoElement,
	VideoTrack,
} from "@/timeline";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { addMediaTime, type MediaTime } from "@/wasm";

export function canRippleInsertOnTrack({
	track,
	insertTime,
	excludeElementIds = [],
}: {
	track: TimelineTrack;
	insertTime: MediaTime;
	excludeElementIds?: readonly string[];
}): boolean {
	const excludedElementIds = new Set(excludeElementIds);
	return !track.elements.some((element) => {
		if (excludedElementIds.has(element.id)) {
			return false;
		}

		const elementEnd = addMediaTime({
			a: element.startTime,
			b: element.duration,
		});
		return element.startTime < insertTime && insertTime < elementEnd;
	});
}

export function resolveRippleInsertTime({
	track,
	requestedTime,
	snapThreshold,
	excludeElementIds,
}: {
	track: TimelineTrack;
	requestedTime: MediaTime;
	snapThreshold: MediaTime;
	excludeElementIds?: readonly string[];
}): MediaTime {
	return (
		findRippleInsertTime({
			track,
			requestedTime,
			snapThreshold,
			excludeElementIds,
		}) ?? requestedTime
	);
}

export function findRippleInsertTime({
	track,
	requestedTime,
	snapThreshold,
	excludeElementIds = [],
}: {
	track: TimelineTrack;
	requestedTime: MediaTime;
	snapThreshold: MediaTime;
	excludeElementIds?: readonly string[];
}): MediaTime | null {
	const excludedElementIds = new Set(excludeElementIds);
	let nearestTime: MediaTime | null = null;
	let nearestDistance = Infinity;

	for (const element of track.elements) {
		if (excludedElementIds.has(element.id)) {
			continue;
		}

		const candidates = [
			element.startTime,
			addMediaTime({ a: element.startTime, b: element.duration }),
		];

		for (const candidate of candidates) {
			const distance = Math.abs(candidate - requestedTime);
			if (distance <= snapThreshold && distance < nearestDistance) {
				nearestTime = candidate;
				nearestDistance = distance;
			}
		}
	}

	return nearestTime;
}

export function applyRippleInsert({
	tracks,
	targetTrackId,
	insertTime,
	duration,
}: {
	tracks: SceneTracks;
	targetTrackId: string;
	insertTime: MediaTime;
	duration: MediaTime;
}): SceneTracks | null {
	if (duration <= 0) {
		return tracks;
	}

	const targetTrack = findTrackInSceneTracks({
		tracks,
		trackId: targetTrackId,
	});
	if (!targetTrack) {
		return null;
	}

	if (!canRippleInsertOnTrack({ track: targetTrack, insertTime })) {
		return null;
	}

	if (tracks.main.id === targetTrackId) {
		return {
			...tracks,
			main: shiftVideoTrackElements({
				track: tracks.main,
				insertTime,
				duration,
			}),
		};
	}

	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.id === targetTrackId
				? shiftOverlayTrackElements({ track, insertTime, duration })
				: track,
		),
		audio: tracks.audio.map((track) =>
			track.id === targetTrackId
				? shiftAudioTrackElements({ track, insertTime, duration })
				: track,
		),
	};
}

export function applyTimelineRippleInsert({
	tracks,
	insertTime,
	duration,
}: {
	tracks: SceneTracks;
	insertTime: MediaTime;
	duration: MediaTime;
}): SceneTracks {
	if (duration <= 0) {
		return tracks;
	}

	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			shiftOverlayTrackElements({ track, insertTime, duration }),
		),
		main: shiftVideoTrackElements({ track: tracks.main, insertTime, duration }),
		audio: tracks.audio.map((track) =>
			shiftAudioTrackElements({ track, insertTime, duration }),
		),
	};
}

// Per-track ripple: shifts later elements on a single track only, leaving every
// other track untouched. This keeps an insert on one row from pushing content on
// unrelated rows (e.g. dropping a graphic must not move the video clips below).
// Unconditional like the timeline-wide variant — callers validate the seam (via
// the drop target) before committing, and place/move their own element after.
export function applyTrackRippleInsert({
	tracks,
	targetTrackId,
	insertTime,
	duration,
}: {
	tracks: SceneTracks;
	targetTrackId: string;
	insertTime: MediaTime;
	duration: MediaTime;
}): SceneTracks {
	if (duration <= 0) {
		return tracks;
	}

	if (tracks.main.id === targetTrackId) {
		return {
			...tracks,
			main: shiftVideoTrackElements({
				track: tracks.main,
				insertTime,
				duration,
			}),
		};
	}

	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.id === targetTrackId
				? shiftOverlayTrackElements({ track, insertTime, duration })
				: track,
		),
		audio: tracks.audio.map((track) =>
			track.id === targetTrackId
				? shiftAudioTrackElements({ track, insertTime, duration })
				: track,
		),
	};
}

function shiftElementStart<TElement extends TimelineElement>({
	element,
	insertTime,
	duration,
}: {
	element: TElement;
	insertTime: MediaTime;
	duration: MediaTime;
}): TElement {
	if (element.startTime < insertTime) {
		return element;
	}

	return {
		...element,
		startTime: addMediaTime({
			a: element.startTime,
			b: duration,
		}),
	};
}

function shiftVideoTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: VideoTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): VideoTrack {
	return {
		...track,
		elements: track.elements.map((element: VideoElement | ImageElement) =>
			shiftElementStart({ element, insertTime, duration }),
		),
	};
}

function shiftTextTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: TextTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): TextTrack {
	return {
		...track,
		elements: track.elements.map((element: TextElement) =>
			shiftElementStart({ element, insertTime, duration }),
		),
	};
}

function shiftGraphicTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: GraphicTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): GraphicTrack {
	return {
		...track,
		elements: track.elements.map((element: StickerElement | GraphicElement) =>
			shiftElementStart({ element, insertTime, duration }),
		),
	};
}

function shiftEffectTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: EffectTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): EffectTrack {
	return {
		...track,
		elements: track.elements.map((element: EffectElement) =>
			shiftElementStart({ element, insertTime, duration }),
		),
	};
}

function shiftAudioTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: AudioTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): AudioTrack {
	return {
		...track,
		elements: track.elements.map((element: AudioElement) =>
			shiftElementStart({ element, insertTime, duration }),
		),
	};
}

function shiftOverlayTrackElements({
	track,
	insertTime,
	duration,
}: {
	track: OverlayTrack;
	insertTime: MediaTime;
	duration: MediaTime;
}): OverlayTrack {
	switch (track.type) {
		case "video":
			return shiftVideoTrackElements({ track, insertTime, duration });
		case "text":
			return shiftTextTrackElements({ track, insertTime, duration });
		case "graphic":
			return shiftGraphicTrackElements({ track, insertTime, duration });
		case "effect":
			return shiftEffectTrackElements({ track, insertTime, duration });
	}
}
