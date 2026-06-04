import type { ParamValues } from "@/params";
import type { TextTrack, TimelineElement } from "@/timeline/types";
import { stripContent } from "@/short-gen/apply-telop-style";

export interface BulkStyleUpdate {
	trackId: string;
	elementId: string;
	// Matches `UpdateElementsCommand`'s `patch` shape (`Partial<TimelineElement>`);
	// we only ever set `params`, never timing fields.
	patch: Partial<TimelineElement>;
}

/**
 * Build the per-element updates that apply one style (`styleParams`) to every
 * text element on `track`, keeping each element's own caption text.
 *
 * The `content` key is stripped from `styleParams` so the source style never
 * overwrites another telop's text — this is what makes "edit one → apply to
 * all" and "apply a saved template to all" safe to run on a populated track.
 *
 * Timing fields (startTime/duration/trimStart/trimEnd) are never touched: only
 * `patch.params` is set. Pure: no wasm/editor access, so it stays bun-testable.
 */
export function buildApplyStyleToTrackUpdates({
	track,
	styleParams,
}: {
	track: TextTrack;
	styleParams: Partial<ParamValues>;
}): BulkStyleUpdate[] {
	const styleWithoutContent = stripContent({ styleParams });

	return track.elements.map((element) => ({
		trackId: track.id,
		elementId: element.id,
		// `Object.assign` onto a `ParamValues` copy keeps the value type as
		// `ParamValue`; a spread of the partial would widen it with `undefined`
		// and break assignability to `ParamValues`.
		patch: {
			params: Object.assign({ ...element.params }, styleWithoutContent),
		},
	}));
}
