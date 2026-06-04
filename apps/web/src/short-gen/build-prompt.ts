import { getPreset } from "@/short-gen/presets";
import type { ComposeRequest } from "@/short-gen/schema";

const GENERIC_INSTRUCTION = [
	"以下の制約を必ず守ること:",
	"・冒頭0〜3秒のフックが最重要。ここで視聴者の離脱を防ぐ。",
	"・1動画1メッセージに絞る。",
	"・指定された尺(秒)に収める。",
	"・ラスト3秒にCTAを入れる。",
].join("\n");

/**
 * Builds the system + user prompt pair for the short-composition request.
 *
 * Pure: no I/O, no SDK. The system prompt states the role and the OUTPUT
 * CONTRACT (which segment indices to use, their order, a caption per clip, a
 * hook, and a CTA), embeds the chosen preset's guidance, and repeats the common
 * short-form constraints. The user prompt lists the target length and the
 * numbered transcript segments.
 */
export function buildShortPlanPrompt({
	request,
}: {
	request: ComposeRequest;
}): { system: string; user: string } {
	const preset = getPreset(request.presetId);
	const presetLabel = preset?.label ?? "汎用テンプレート";
	const instruction = preset?.instruction ?? GENERIC_INSTRUCTION;

	const system = [
		"あなたはショート動画(縦型短尺動画)の編集者です。",
		"渡された文字起こしセグメントの中から使うものを選び、並び替えて、テンプレートに沿った1本のショートを構成します。",
		"",
		`# 選択されたテンプレート: ${presetLabel}`,
		instruction,
		"",
		"# OUTPUT CONTRACT (出力契約)",
		"次の内容だけを返すこと:",
		"(a) どのセグメント番号(segmentIndex)を使うか",
		"(b) それらの並び順(order)",
		"(c) クリップごとのテロップ文(caption)",
		"(d) 冒頭フック文(hookText)",
		"(e) CTA文(ctaText)",
		"segmentIndex は必ず、渡されたセグメント番号のいずれかでなければならない。存在しない番号を返してはならない。",
		"",
		"# テロップ(caption)の鉄則 — 最重要",
		"・caption は、対象セグメントの発言テキストを『ほぼそのまま』使うこと。原文から重要部分を抜き出す/長い場合は末尾を削る、だけにする。",
		"・言い換え・要約による単語の置き換え・創作は禁止。特に名詞(場所・物・キーワード)を別の語に変えてはならない。",
		"・原文に無い情報は一切書かない。意味を変えたら誤情報であり厳禁。",
		"・良い例: 発言「朝日を浴びるとセロトニンが出て気分が安定する」→ caption「朝日を浴びるとセロトニンが出て気分が安定」(原文の語をそのまま抜粋)。",
		"・悪い例(禁止): 同じ発言を caption「体を冷やすとセロトニンが出る」にする(『朝日』を『体を冷やす』に変えた=意味改変)。",
		"・hookText と ctaText だけは視聴者を引きつける表現で創作してよい。ただし動画の内容と矛盾しないこと。",
		"",
		"# 共通制約",
		"・冒頭フックが最重要。ここで視聴者の離脱を防ぐ。",
		"・1動画1メッセージに絞る。",
		"・指定された尺(秒)に収める。",
		"・ラスト3秒にCTAを入れる。",
	].join("\n");

	const segmentLines = request.segments
		.map(
			(segment) =>
				`[${segment.index}] (${segment.start}s-${segment.end}s) ${segment.text}`,
		)
		.join("\n");

	const user = [
		`目標尺: ${request.targetSeconds}秒`,
		"",
		"文字起こしセグメント一覧:",
		segmentLines,
	].join("\n");

	return { system, user };
}
