# 無音カット（Vrew風）設計 — IPA-1310 第1スライス

- 日付: 2026-06-07
- ブランチ: `feature/silence-cut`（`fork/main` から分岐）
- 関連: 親エピック IPA-1320（AI動画編集）、IPA-1310（無音・フィラー自動カット）

## 答える問い

「動画の "しゃべっていない間（無音）" を Vrew のように自動で見つけて詰める」を、
OpenCut のAI動画編集に最小・確実な形で載せる。

## 決定事項（ユーザー合意）

1. **出力方式 = (A) きれいなコピーを生成（非破壊）**
   元動画は触らず、無音を抜いた「詰めた版」を新しいシーンとして作る。既存の
   AIショート機構（`specsToElements` → `applyShortToTimeline`）をそのまま流用でき、
   最速かつ安全。Vrew本来の「その場でリップル編集」(B) は将来の拡張。
2. **第1スライス = 無音カットのみ**
   波形ベースで確実に作れる無音カットを先に出す。言い淀み（フィラー）カットは
   日本語の単語タイムスタンプ精度の実機検証が必要なため別スライス（下記）。

## アーキテクチャ

```
ユーザーが動画を選択
  → extractAssetMonoSamples（mediabunnyで音声抽出 → 16kHzモノPCM）  ［重い・1回だけ］
  → detectSilences（純粋・wasm非依存）                              ［軽い・スライダー毎に即再計算］
      = 無音区間（除去）と キープ区間（残す発話）を返す
  → keepIntervalsToClipSpecs → specsToElements → applyShortToTimeline
      = キープ区間を背中合わせに並べた新シーン「無音カット（〜）」を生成
```

- **純粋ロジック**: `apps/web/src/short-gen/silence-detection.ts`
  - `detectSilences({samples, sampleRate, options})` → `{silences, keep, totalSec}`
  - `summarizeSilenceCut({silences, totalSec})` → `{originalSec, resultSec, removedSec, removedCount}`
  - `keepIntervalsToClipSpecs({keep})` → `ClipSpec[]`（caption空、背中合わせ）
  - wasm/Web Audio に一切依存しないので **bun-test で完全ユニットテスト可能**（11ケース）。
- **ブラウザ連結**: `apps/web/src/short-gen/cut-silence.ts`
  - `extractSilenceSource({editor, asset})` → デコード済みPCM + ソース記述子（高コスト、1回）
  - `applySilenceCut({editor, descriptor, keep, sceneName})` → 新シーンに反映
  - 音声抽出は `transcription/run-transcription.ts` に追加した `extractAssetMonoSamples`
    （文字起こしと同じ抽出経路を再利用＝動画コンテナの音声も正しくデマックス）。
- **UI**: `apps/web/src/short-gen/components/silence-cut-view.tsx` ＋ 新タブ「無音カット」
  （`assets-panel-store.tsx` / `panels/assets/index.tsx`）。
  動画選択 → 解析 → スライダー3本（強さ/最小無音長/余白）＋ before-afterバー → 適用。

## アルゴリズム（無音検出）

1. PCM を短い窓（既定20ms）に分割し、窓ごとに RMS を算出。
2. RMS が しきい値（既定 -40 dBFS）未満の窓を「無音」と判定。
3. 連続する無音窓をまとめて無音区間にする。
4. `minSilenceSec`（既定0.6秒）より短い無音は「自然な間」として残す。
5. 残った無音区間を前後 `paddingSec`（既定0.1秒）だけ内側に縮める（発話の頭・尻を切らない）。
6. 無音区間の補集合 = キープ区間。`minKeepSec`（既定0.15秒）未満の細切れは捨てる。

既定値は `DEFAULT_SILENCE_OPTIONS` に集約し、UIスライダーと共有（ズレ防止）。

## QA（実機）必須・ブラウザ限定

純粋ロジックはユニットテスト済みだが、以下は wasm/ブラウザ依存のためローカル単体テスト
不可。AIショートのレンダ連鎖と同様に **実機での目視QA** が必要:
- `extractAssetMonoSamples` の音声抽出（動画コンテナ）
- 生成シーンの再生（キープ区間が背中合わせに正しく並ぶ／無音が消える）
- 長尺（10〜20分）でのクリップ数・取り消し（undo）・操作のもたつき

## 次のスライス（フィラーカット）

「えー / あの / えーと」のインライン除去には **単語レベルのタイムスタンプ** が必要。
現在の Whisper は chunk 単位（`return_timestamps: true`）。`'word'` 化は設定変更だが、
**日本語の単語タイムスタンプ精度は未検証**（空白なし言語）。UXを作り込む前に、
短い日本語クリップで「単語ごとに ~100ms 精度のタイムスタンプが出るか」を実機検証する
こと。出ない場合はフィラーカットは別設計（強制アライメント等）になる。

## 検証結果（このスライス）

- ユニットテスト: `silence-detection.test.ts` 11ケース green、short-gen全体 72 pass / 0 fail
- eslint: 追加ファイルはクリーン
- tsc: 追加ファイルに新規エラー0（既存 baseline エラーは別ファイル）
- `next build`: CI（Linux）を正とする
