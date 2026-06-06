export type Part = {
	id: string;
	label: string;
	instruction: string;
};

export const HOOKS: Part[] = [
	{
		id: "shock-fact",
		label: "衝撃の事実",
		instruction: "「〇〇を知らないのは損」など衝撃的な事実で冒頭をつかむ",
	},
	{
		id: "question",
		label: "疑問提起",
		instruction: "「なぜ〇〇は△△なのか?」と問いを投げて引き込む",
	},
	{
		id: "number",
		label: "数字訴求",
		instruction: "具体的な数字で価値を提示する（例「30秒で〇〇」）",
	},
	{
		id: "benefit",
		label: "ベネフィット提示",
		instruction: "視聴後に得られる利益を冒頭で示す",
	},
	{
		id: "surprise",
		label: "意外性・逆張り",
		instruction: "常識を覆す/予想外の切り口で始める",
	},
	{
		id: "empathy",
		label: "共感(あるある)",
		instruction: "「〇〇あるある」で共感を得る",
	},
	{
		id: "before-after-show",
		label: "ビフォーアフター見せ",
		instruction: "結果・完成を先に見せる",
	},
];

export const BODY_FRAMES: Part[] = [
	{
		id: "explain",
		label: "解説",
		instruction: "要点を分かりやすく解説する流れ",
	},
	{
		id: "pasona",
		label: "課題解決(PASONA)",
		instruction: "課題→共感→解決→効果の流れ",
	},
	{
		id: "prep",
		label: "結論先出し(PREP)",
		instruction: "結論→理由→具体例→結論の流れ",
	},
	{
		id: "list",
		label: "リスト/〇〇選",
		instruction: "項目を列挙・カウントダウンする流れ",
	},
	{
		id: "compare",
		label: "比較(〇〇の違い)",
		instruction: "2つを対比して違いを示す流れ",
	},
	{
		id: "quiz",
		label: "クイズ・問いかけ",
		instruction: "問い→答えで参加を促す流れ",
	},
	{
		id: "lifehack",
		label: "スゴ技・裏ワザ",
		instruction: "知って得する技を手順で見せる流れ",
	},
	{
		id: "storytelling",
		label: "ストーリーテリング",
		instruction: "導入→展開→オチの流れ",
	},
	{
		id: "summary",
		label: "要点まとめ",
		instruction: "長尺の要点だけを圧縮する流れ",
	},
];

export const CTAS: Part[] = [
	{
		id: "follow",
		label: "フォロー促進",
		instruction: "フォローを促す",
	},
	{
		id: "save",
		label: "保存促進",
		instruction: "「後で見返す人は保存」と促す",
	},
	{
		id: "profile",
		label: "プロフィール誘導",
		instruction: "プロフィール/リンクへ誘導する",
	},
	{
		id: "next",
		label: "次回予告",
		instruction: "次の動画への期待を作る",
	},
];

export const getHook = (id: string): Part | null =>
	HOOKS.find((part) => part.id === id) ?? null;

export const getBodyFrame = (id: string): Part | null =>
	BODY_FRAMES.find((part) => part.id === id) ?? null;

export const getCta = (id: string): Part | null =>
	CTAS.find((part) => part.id === id) ?? null;
