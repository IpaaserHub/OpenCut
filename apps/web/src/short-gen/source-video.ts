import type { MediaAsset } from "@/media/types";
import type { ParamValues } from "@/params";
import type { TScene } from "@/timeline";
import { buildDefaultElementParams } from "@/timeline/element-utils";

/**
 * Locate the long source video being edited on the active scene.
 *
 * `SceneTracks` is not a flat list: the editing surface keeps a single `main`
 * video track plus `overlay` tracks (and `audio`, which can't hold video). We
 * scan main-first, then overlays, and return the first `type:"video"` element's
 * `{mediaId, params}` — the asset the AI short will be cut from. Image elements
 * also carry a `mediaId`, so we explicitly require `type === "video"`.
 */
export function findSourceVideo({
	scene,
}: {
	scene: TScene;
}): { mediaId: string; params: ParamValues } | null {
	const tracks = [scene.tracks.main, ...scene.tracks.overlay];
	for (const track of tracks) {
		for (const element of track.elements) {
			if (element.type === "video") {
				return { mediaId: element.mediaId, params: element.params };
			}
		}
	}
	return null;
}

/**
 * Build the source video descriptor from a media-library asset the user picked
 * in the AI short panel (rather than scanning the active scene). The asset is
 * not necessarily placed on any timeline, so we give it the default full-frame
 * video params — the clips reference it by `mediaId`, which stays valid
 * project-wide.
 */
export function sourceVideoFromAsset({
	asset,
}: {
	asset: MediaAsset;
}): { mediaId: string; params: ParamValues } {
	return {
		mediaId: asset.id,
		params: buildDefaultElementParams({ type: "video" }),
	};
}
