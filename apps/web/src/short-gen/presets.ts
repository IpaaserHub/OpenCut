import { getBodyFrame, getCta, getHook } from "@/short-gen/parts";

export type Preset = {
	id: string;
	label: string;
	description: string;
	hook: string;
	body: string;
	cta: string;
	instruction: string;
};

const SHARED_CONSTRAINTS = [
	"以下の制約を必ず守ること:",
	"・冒頭0〜3秒のフックが最重要。ここで視聴者の離脱を防ぐ。",
	"・1動画1メッセージに絞る。",
	"・指定された尺(秒)に収める。",
	"・ラスト3秒にCTAを入れる。",
	"・出力は「使う文字起こしセグメントの番号・並び順・各テロップ文・冒頭フック文・CTA文」だけにする。",
].join("\n");

type PresetConfig = {
	id: string;
	label: string;
	description: string;
	hook: string;
	body: string;
	cta: string;
};

const PRESET_CONFIGS: PresetConfig[] = [
	{
		id: "conclusion-first",
		label: "結論先出し型",
		description: "冒頭で結論を見せて離脱を防ぐ",
		hook: "shock-fact",
		body: "prep",
		cta: "save",
	},
	{
		id: "problem-solution",
		label: "問題提起→解決型",
		description: "悩み・ノウハウ系向け",
		hook: "question",
		body: "pasona",
		cta: "profile",
	},
	{
		id: "list-3",
		label: "〇〇3選/リスト型",
		description: "列挙で最後まで見せる",
		hook: "number",
		body: "list",
		cta: "follow",
	},
	{
		id: "how-to",
		label: "How-to手順型",
		description: "やり方を順番に解説",
		hook: "benefit",
		body: "lifehack",
		cta: "save",
	},
	{
		id: "summary",
		label: "要点まとめ型",
		description: "長尺の要点を圧縮",
		hook: "question",
		body: "summary",
		cta: "next",
	},
];

function buildInstruction(config: PresetConfig): string {
	const hook = getHook(config.hook);
	const body = getBodyFrame(config.body);
	const cta = getCta(config.cta);
	if (!hook || !body || !cta) {
		throw new Error(
			`Unknown part id in preset "${config.id}": hook=${config.hook} body=${config.body} cta=${config.cta}`,
		);
	}
	return [
		SHARED_CONSTRAINTS,
		`フック: ${hook.instruction}`,
		`本編の構成: ${body.instruction}`,
		`CTA: ${cta.instruction}`,
	].join("\n");
}

export const PRESETS: Preset[] = PRESET_CONFIGS.map((config) => ({
	...config,
	instruction: buildInstruction(config),
}));

export const getPreset = (id: string): Preset | null =>
	PRESETS.find((preset) => preset.id === id) ?? null;
