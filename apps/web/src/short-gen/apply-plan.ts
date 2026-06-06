import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import type { EditorCore } from "@/core";
import type { CreateTextElement, CreateVideoElement } from "@/timeline/types";

/**
 * Commit the computed AI-short elements onto the timeline as one undoable step.
 *
 * Mirrors `@/subtitles/insert`: create the destination tracks, build an
 * `InsertElementCommand` per element bound to the right track by explicit
 * placement, then run everything inside a single `BatchCommand`. Track ids are
 * available pre-execution because `AddTrackCommand` mints its UUID in its
 * constructor.
 */
export function applyShortToTimeline({
	editor,
	videoElements,
	textElements,
	ctaTextElement,
}: {
	editor: EditorCore;
	videoElements: CreateVideoElement[];
	textElements: CreateTextElement[];
	ctaTextElement?: CreateTextElement | null;
}): { videoTrackId: string; textTrackId: string; ctaTrackId: string | null } {
	const addVideoTrack = new AddTrackCommand({
		type: "video",
		name: "AIショート動画",
	});
	const addTextTrack = new AddTrackCommand({
		type: "text",
		name: "AIショート字幕",
	});
	const videoTrackId = addVideoTrack.getTrackId();
	const textTrackId = addTextTrack.getTrackId();

	const insertVideoCommands = videoElements.map(
		(element) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId: videoTrackId },
				element,
			}),
	);
	const insertTextCommands = textElements.map(
		(element) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId: textTrackId },
				element,
			}),
	);

	// The end CTA lives on its OWN text track so it can overlap the caption track
	// in time without an element conflict. Only created when a CTA element exists.
	const addCtaTrack = ctaTextElement
		? new AddTrackCommand({ type: "text", name: "AIショートCTA" })
		: null;
	const ctaTrackId = addCtaTrack ? addCtaTrack.getTrackId() : null;
	const insertCtaCommands =
		addCtaTrack && ctaTextElement
			? [
					new InsertElementCommand({
						placement: { mode: "explicit", trackId: addCtaTrack.getTrackId() },
						element: ctaTextElement,
					}),
				]
			: [];

	editor.command.execute({
		command: new BatchCommand([
			// Add the text/CTA tracks BEFORE the video track. New overlay tracks
			// append to the end, and overlay[0] renders on top (see scene-builder:
			// visibleTracks is reversed to draw bottom-to-top). Adding text first
			// gives it the lower (front) overlay index, so the full-frame video no
			// longer covers the captions.
			addTextTrack,
			...(addCtaTrack ? [addCtaTrack] : []),
			addVideoTrack,
			...insertVideoCommands,
			...insertTextCommands,
			...insertCtaCommands,
		]),
	});

	return { videoTrackId, textTrackId, ctaTrackId };
}
