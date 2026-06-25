import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { SceneTracks } from "@/timeline";
import { closeTrackGap } from "@/timeline/placement";
import type { MediaTime } from "@/wasm";

export class CloseGapCommand extends Command {
	private savedState: SceneTracks | null = null;

	constructor({
		trackId,
		gapStartTime,
		gapDuration,
	}: {
		trackId: string;
		gapStartTime: MediaTime;
		gapDuration: MediaTime;
	}) {
		super();
		this.trackId = trackId;
		this.gapStartTime = gapStartTime;
		this.gapDuration = gapDuration;
	}

	private readonly trackId: string;
	private readonly gapStartTime: MediaTime;
	private readonly gapDuration: MediaTime;

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedState = editor.scenes.getActiveScene().tracks;

		const updatedTracks = closeTrackGap({
			tracks: this.savedState,
			trackId: this.trackId,
			gapStartTime: this.gapStartTime,
			gapDuration: this.gapDuration,
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			const editor = EditorCore.getInstance();
			editor.timeline.updateTracks(this.savedState);
		}
	}
}
