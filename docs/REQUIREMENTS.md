# 要件定義書 — pixiv AI Metadata Inspector

Version: 0.1.0 / 2026-10-22
Status: **draft specification; prototype implementation is NOT complete**

## 1. 背景・目的
pixivの作品画像を閲覧しながら、可能な範囲で画像ファイル内部のAI生成メタデータを抽出・閲覧する。NovelAI、ComfyUI、AUTOMATIC1111/Forgeなどの主要形式を対象とする。既存の汎用拡張 AI Meta Viewer/Prompt Seek との差分は、pixivの原寸画像の選択・複数枚の対応・NovelAI固有のメタデータ/署名状態の明示・透明な失敗説明。

最重要: 「画像がAI生成か」を絵柄から判定するツールではない。メタデータがない、消されている、偽装された場合に確証は得られない。

## 2. 対象環境
- Chrome 及び Chromium系Edge、Manifest V3、デスクトップを初期対象。
- pixivの `https://www.pixiv.net/artworks/{id}` の閲覧画面。
- Chrome Web Store/GitHub一般公開を将来的に想定。
- タブ内UI＋ローカルファイル選択。バックエンド不使用。
- R18作品についても**ユーザーがpixiv上で正規に閲覧できる場合のみ**同じ機能を提供する。年齢制限・認証の回避は一切しない。

## 3. ユーザーフロー
1. ユーザーがpixivの作品ページを開く。
2. 小さな `AI Metadata` ボタンが表示される（全画像の自動解析はしない）。
3. ボタンを押すと現在の作品のページ番号一覧が表示される。
4. 対象ページを選んで「検査」。取得できる場合は原寸画像のバイト列をローカル解析。
5. プロンプト、ネガティブ、モデル、Seed、Steps、CFG、Sampler、ワークフロー等、**存在する情報だけ**を表示。
6. バイト列が取得できなければ状態と原因を明示し、元画像を保存して手動ファイル読込する手順を提示。
7. 検査結果をコピー可能（閲覧結果の操作に限る）。外部へのアップロードを伴わない。

## 4. 機能要件

| ID | 優先 | 要件 | 合格条件 |
|----|-----|------|---------|
| F-01 | P0 | 作品URL検出とpixiv SPA遷移対応 | URL変更後も1回だけボタン表示し、古い画像候補を破棄 |
| F-02 | P0 | 作品の画像一覧と正確な原寸URL解決 | 1枚/複数枚で順序一致、存在しないURLを推測しない |
| F-03 | P0 | ユーザー操作時だけ画像取得、Pixiv/pximg以外へアクセスしない | ネットワークログ、URL検証、並列数1 |
| F-04 | P0 | PNG tEXt / zTXt / iTXt の安全な読取 | 3形式のテスト、壊れたデータでもクラッシュしない |
| F-05 | P0 | NovelAI通常メタデータの判別・表示 | Comment/Description等を適切に抽出、嘘の署名判定なし |
| F-06 | P0 | ComfyUIの `prompt`・`workflow` JSONの閲覧 | JSON構造、ノード情報を失わずRAW表示、危険HTMLなし |
| F-07 | P0 | A1111/Forgeの `parameters` 形式読取 | Prompt, Negative, Sampler, Steps, CFG, Seedを分離できる範囲で表示 |
| F-08 | P0 | ローカル画像読込のフォールバック | 403/429/URL無効・ネットワーク失敗で案内し手動読込可 |
| F-09 | P0 | 認識根拠と不確実性の表示 | 署名/通常メタ/不明/取得不能を別表示 |
| F-10 | P0 | プライバシー保護・適正権限 | 収集なし、サイト横断権限なし、原則保存なし |
| F-11 | P1 | NovelAI Stealth PNG (alpha LSB, stealth_pnginfo, stealth_pngcomp) | 公式仕様に照らしPNGから抽出、通常テキスト欠落時も動作 |
| F-12 | P1 | NovelAI V4/V5キャラクタープロンプトの分離表示 | 共通Promptとchar_captions等を取り違えない |
| F-13 | P1 | NovelAI署名検証 | 公式の署名検証との照合済テスト。実装できないなら一切「検証済」にしない |
| F-14 | P1 | 結果・正規化JSONをコピー | 正しい改行・JSON、安全なクリップボード操作 |
| F-15 | P1 | 複数枚の素早い切替と取り消し | 1度に1リクエスト、前操作を中止可能 |
| F-16 | P1 | JPEG EXIF / WebPメタデータ | 対応キーを読取。不在時も「不明」表示 |
| F-17 | P1 | ストリームで容量制限・画像展開の上限 | oversized / decompression bombへの耐性 |
| F-18 | P2 | 任意のローカルファイルを一括解析 | 明示選択時のみ、同時実行上限あり |
| F-19 | P2 | Chrome Store公開用の多言語対応・設定 | ja/en、プライバシーポリシー、公開素材 |

## 5. 表示情報と判定

### 判定階層
- `署名検証成功 (NovelAI verified)`：公式検証互換ロジックで署名が真に検証された場合に限る。
- `メタデータから推定 (NovelAI/ComfyUI/etc.)`：ソフトウェア名や形式固有JSONなどが見つかった。**偽装可能**。
- `不明`：判別する材料なし。
- `取得不能`：403、429、アクセス拒否、元画像なし、タイムアウト等。
- `未対応`：解析できない形式や機能。

`署名フィールドが存在する`ことを`署名が有効`と言い換えない。ComfyUIはUI/ワークフローであり生成モデル名ではない。NovelAI APIをComfyUIノード経由で使用した場合、利用ツールと生成エンジンは同時に存在し得る。

### UIフィールド
- 識別根拠、媒体形式、画像ページ番号、解析対象URL (コピー可、デフォルトでは全文自動共有しない)。
- Positive/Negative Prompt（ソースが分離可能な場合）。
- キャラクタープロンプト（存在する場合）。
- Model / VAE / LoRA / Seed / Steps / Sampler / CFG / サイズ（存在する場合）。
- ComfyUIノード構成を折り畳んで表示、RAW JSON表示。
- 「この情報は画像内の自己申告データで、第三者が編集できる」という注記。

## 6. 非機能要件
- セキュリティ: URL許可リスト、コンテンツスクリプトから任意URL取得できない、任意プロンプトをテキストとしてエスケープ、CSP準拠。
- プライバシー: 画像・プロンプトはローカル処理、解析結果の永続保存なし、解析ログにプロンプト内容を残さない。
- 性能: 元画像48 MiB上限を初期値とする。必要に応じてユーザーへ警告。ネットワークタイムアウト15秒、同時取得1、無限再試行なし。
- 信頼性: 403/429/権限不足/通信エラーをユーザーへ正しく通知。Pixivページのレイアウト変更にできるだけ依存しない。
- アクセシビリティ: キーボード操作、ARIAライブ領域、フォーカス管理、モバイル幅でのレイアウト崩れ防止。

## 7. 明確な非対象
- pixiv全作品の検索・クロール・一括収集、ランキングや作者ページの一括解析。
- 画像保存制限の回避、ログイン・年齢制限の回避、署名やメタデータの偽造。
- キャラクターの特定、画像生成AIであるかの見た目による確定判定。
- 投稿者個人情報の収集、画像・プロンプトのクラウド同期。
- 外部API経由で原寸画像を代理取得するプロキシ。

## 8. MVP受入テスト (release gate)
- R-01: 通常PNG NovelAI・ComfyUI・A1111・メタデータなしを正しく区別。
- R-02: zTXt/iTXt圧縮、破損、異常なチャンク長、悪意あるテキストで失敗してもUIが安全。
- R-03: 署名なし/署名文字列だけの偽データで「署名検証成功」と表示しない。
- R-04: pixiv1枚/複数枚/SPA遷移・ダークモード・ログアウト時エラー表示。
- R-05: 403・429・過大ファイル・Content-Type不一致で、拡張は破綻せず手動読込を案内。
- R-06: 作品ページを表示しているだけでは原寸画像の大量ダウンロードが起きない。
- R-07: URL偽造で第三者ドメインのデータをサービスワーカーに取得させられない。
- R-08: 同一ユーザー操作を何度も押しても同時ネットワーク取得は1件だけ。
- R-09: `npm run typecheck && npm test && npm run build` 成功。
- R-10: ブラウザ実機検証結果に「PASS/FAIL/NOT RUN」を分けて記録。

## 9. 先行事例・調査リンク
- https://chromewebstore.google.com/detail/ai-meta-viewer/glggkpjfgbabooefiijgnaemfabdmkgf
- https://sora-tsukigase.com/en/prompt-seek/
- https://github.com/NovelAI/novelai-image-metadata
- https://github.com/Comfy-Org/docs/blob/main/built-in-nodes/SaveImage.mdx
- https://www.pixiv.help/hc/ja/articles/235584428
- https://inside.pixiv.blog/2023/05/09/183635
- https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions
