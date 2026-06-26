import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "playback"
	| "navigation"
	| "editing"
	| "selection"
	| "history"
	| "timeline"
	| "controls"
	| "assets";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "再生/一時停止",
		category: "playback",
	},
	"stop-playback": {
		description: "再生を停止",
		category: "playback",
	},
	"seek-forward": {
		description: "1秒進む",
		category: "playback",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "1秒戻る",
		category: "playback",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "1フレーム進む",
		category: "navigation",
	},
	"frame-step-backward": {
		description: "1フレーム戻る",
		category: "navigation",
	},
	"jump-forward": {
		description: "5秒進む",
		category: "navigation",
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "5秒戻る",
		category: "navigation",
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "タイムラインの先頭へ移動",
		category: "navigation",
	},
	"goto-end": {
		description: "タイムラインの末尾へ移動",
		category: "navigation",
	},
	split: {
		description: "再生ヘッド位置で要素を分割",
		category: "editing",
	},
	"split-left": {
		description: "分割して左側を削除",
		category: "editing",
	},
	"split-right": {
		description: "分割して右側を削除",
		category: "editing",
	},
	"delete-selected": {
		description: "選択中の要素を削除",
		category: "editing",
	},
	"copy-selected": {
		description: "選択中の要素をコピー",
		category: "editing",
	},
	"paste-copied": {
		description: "再生ヘッド位置に貼り付け",
		category: "editing",
	},
	"toggle-snapping": {
		description: "スナップを切り替え",
		category: "editing",
	},
	"toggle-ripple-editing": {
		description: "リップル編集を切り替え",
		category: "editing",
	},
	"toggle-source-audio": {
		description: "元音声の抽出/復元",
		category: "editing",
	},
	"select-all": {
		description: "すべての要素を選択",
		category: "selection",
	},
	"cancel-interaction": {
		description: "現在の操作をキャンセル",
		category: "controls",
	},
	"deselect-all": {
		description: "すべての選択を解除",
		category: "selection",
	},
	"duplicate-selected": {
		description: "選択中の要素を複製",
		category: "selection",
	},
	"toggle-elements-muted-selected": {
		description: "選択中の要素のミュートを切り替え",
		category: "selection",
	},
	"toggle-elements-visibility-selected": {
		description: "選択中の要素の表示を切り替え",
		category: "selection",
	},
	"toggle-bookmark": {
		description: "再生ヘッド位置のブックマークを切り替え",
		category: "timeline",
	},
	undo: {
		description: "元に戻す",
		category: "history",
	},
	redo: {
		description: "やり直す",
		category: "history",
	},
	"remove-media-asset": {
		description: "メディア素材を削除",
		category: "assets",
		args: { projectId: "string", assetId: "string" },
	},
	"remove-media-assets": {
		description: "メディア素材を削除",
		category: "assets",
		args: { projectId: "string", assetIds: "string[]" },
	},
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

const REQUIRED_ARG_ACTIONS: ReadonlySet<string> = new Set([
	"remove-media-asset",
	"remove-media-assets",
]);

export function isAction(value: string): value is TAction {
	return value in ACTIONS;
}

export function isActionWithOptionalArgs(
	value: string,
): value is TActionWithOptionalArgs {
	return isAction(value) && !REQUIRED_ARG_ACTIONS.has(value);
}

const ACTION_DEFAULT_SHORTCUTS = [
	["toggle-play", ["space", "k"]],
	["seek-forward", ["l"]],
	["seek-backward", ["j"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward", ["left"]],
	["jump-forward", ["shift+right"]],
	["jump-backward", ["shift+left"]],
	["goto-start", ["home", "enter"]],
	["goto-end", ["end"]],
	["split", ["s"]],
	["split-left", ["q"]],
	["split-right", ["w"]],
	["delete-selected", ["backspace", "delete"]],
	["copy-selected", ["ctrl+c"]],
	["paste-copied", ["ctrl+v"]],
	["toggle-snapping", ["n"]],
	["select-all", ["ctrl+a"]],
	["cancel-interaction", ["escape"]],
	["duplicate-selected", ["ctrl+d"]],
	["undo", ["ctrl+z"]],
	["redo", ["ctrl+shift+z", "ctrl+y"]],
] as const satisfies ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

const ACTION_DEFAULT_SHORTCUTS_BY_ACTION = new Map<
	TAction,
	readonly ShortcutKey[]
>(ACTION_DEFAULT_SHORTCUTS);

export function getActionDefinition({
	action,
}: {
	action: TAction;
}): TActionDefinition {
	return {
		...ACTIONS[action],
		defaultShortcuts: ACTION_DEFAULT_SHORTCUTS_BY_ACTION.get(action),
	};
}

export function getDefaultShortcuts(): Map<
	ShortcutKey,
	TActionWithOptionalArgs
> {
	const shortcuts = new Map<ShortcutKey, TActionWithOptionalArgs>();

	for (const [action, defaultShortcuts] of ACTION_DEFAULT_SHORTCUTS) {
		for (const shortcut of defaultShortcuts) {
			shortcuts.set(shortcut, action);
		}
	}

	return shortcuts;
}
