import type { ParamValues } from "@/params";
import type { TScene } from "@/timeline";

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
