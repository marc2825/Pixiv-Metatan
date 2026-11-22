# 要件定義 — Pixiv-Metatan

更新: 2026-11-22。検証状況は[TEST_STATUS.md](TEST_STATUS.md)、未完了の作業は[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。

## 目的・対象

Chrome / Chromium Edge（MV3、最小120）で、pixivのサムネイルのプレビューと、ユーザーの明示操作による表示ページのメタデータ確認を提供する。画像の見た目からAI生成を判定しない。

対象画面: 検索、ランキング、ユーザーの投稿・ブックマーク、フォロー新着、作品ページ（関連作品と従来パネル）。正規の作品リンク内（またはその直近のカード内）の画像から作品IDと安全な表示用URLを識別できる場合に限る。タイトル・作者名はDOMから取れる値だけを使う。ユーザーが正規にアクセスできる範囲だけを扱う。

## 操作の受入条件

| ID | 要件 | 合格条件 |
|---|---|---|
| H-01 | 約250msのホバー遅延 | 短い通過では通信しない。スイープ中は一覧の取得をさらに150ms待ち、離れたカードでは取得しない。遅延読み込みのカードにもイベント委譲で対応 |
| H-02 | フローティングプレビュー | 縦横比維持、画面内配置、ライト/ダーク、スクロール追従、画面外・削除されたカードでは閉じる |
| H-03 | 閉じる・移動・標準操作 | パネルへ移動して継続、両方から離れて約200msで閉じる、Escape、フォーカス復帰、元リンクの通常動作を維持 |
| H-04 | 複数ページ切替 | 正確な順序、ページ/総数、前後ボタン、左右キー、wheel（閾値80px・350msクールダウン・連続ジェスチャ1回） |
| H-05 | 必要なイベントだけ抑制 | 複数枚の画像領域のwheelだけ抑制。単一画像・結果内スクロール・ページ本体は通常操作。Escapeはフォーカスが拡張外ならページにも届く |
| H-06 | 表示と解析の分離 | 表示はAPI縮小画像/元サムネイル。原寸はMetadata/Inspectのクリック時に1枚だけ |
| H-07 | ページ単位の結果 | 切替で古い結果を除去。解析済みページのみ一時キャッシュから表示 |
| H-08 | 状態の区別 | 解析中・情報あり・なし・未対応形式・取得不能・解析失敗・上限超過・取消・busyを区別 |
| H-09 | 分かる失敗説明 | APIと原寸の401/403/404/429/5xx/timeoutを層別に表示。プレビュー継続。ローカル読込の案内 |
| H-10 | 安全な表示とコピー | Prompt/Negative・主設定、グラフ/RAWの折り畳み、クリック時だけのコピー |
| H-11 | 旧機能維持 | 作品ページの従来パネル、ローカルファイル、取消、既存パーサーの回帰試験 |
| H-12 | 検査対象外のページ | 原寸URLが対応外の形式のページはページ番号を保ったままプレビューのみ。検査ボタンは無効 |

## メタデータの受入条件

| ID | 形式 | 合格条件 |
|---|---|---|
| M-01 | PNG tEXt/zTXt/iTXt | 構造・CRC・上限・文字コード・重複キーの扱いを維持 |
| M-02 | NovelAI（PNGテキスト） | Software自己申告 + Description/Source/Comment、1段のComment envelope、V4/V4.5キャラクター別Prompt（公式APIスキーマに一致する場合のみ） |
| M-03 | NovelAI Stealth | 公式の書込み・読込みと一致（`stealth_pngcomp`）。非対応の配置は「未検査」、アルファなしは「なし」 |
| M-04 | ComfyUI | prompt/workflowの完全なJSONを折り畳み表示。モデル・Promptを推測しない（PNGテキストとWebP EXIF） |
| M-05 | AUTOMATIC1111/Forge | parameters（PNG）・UserComment（JPEG/WebP）。引用符内のカンマを区切らない |
| M-06 | 判定の意味 | 「メタデータから推定」。署名は未検証と表示し、検証済みにしない。不在・未対応・取得不能を非AI生成の根拠にしない |

## 通信・権限・性能

- 一覧を走査・巡回しない。ホバー/フォーカスした作品のページ一覧APIだけを使う。原寸URLはAPIの応答から採用し、再構築しない。
- 表示URLはHTTPSの`i.pximg.net`縮小画像パスと作品/ページを検証する。解析URLは`https://i.pximg.net/img-original/img/…/{id}_p{page}.{png|jpg|jpeg|webp}`だけ。
- メッセージは自拡張のpixiv top frame、tab ID、作品ID（作品パネル）または操作時の完全なURL（ホバー）を取得前後に照合する。ページスクリプト用の橋や汎用fetchを公開しない。
- 原寸取得はWorkerから`credentials:omit`・`redirect:error`で行い、全タブで1件。自動再試行・先読みなし。i.pximg.netが要求する`Referer: https://www.pixiv.net/`だけを、セッションルールで付ける（この拡張が開始・タブなし・GET・`img-original`に限定。応答ヘッダー・他サイト・pixivのページの通信は変更しない。2026-11-22のメンテナー決定、Issue #9）。429はRetry-After（最低60秒）をWorkerとタブで尊重する。失敗時は説明とローカル読込を提供する。
- キャッシュ: 一覧24件/推定2 MiB/2分、結果8件/推定8 MiB/2分のLRU（タブ内メモリ）。画像バイト列はキャッシュしない。SPA・BFCache・破棄で全消去。
- 上限: API JSON 1 MiB、原寸/ローカル48 MiB、テキスト2 MiB、40百万画素、Stealth圧縮1 MiB・1行1 MiB、通信15秒。
- 閉じたShadow DOM、`textContent`、最小のpixiv/pximgホスト権限。API権限は`declarativeNetRequestWithHostAccess`（上記Refererのみ）。Cookie・トークンを読まない。
- 画像・Promptは端末内だけで処理し、永続保存・外部送信・追跡ライブラリを導入しない。

## 非目標

全作品の自動解析、バッチ収集・一括ダウンロード、ログイン・年齢・アクセス・レート制限の回避、上記以外のヘッダー変更やCORS応答の書き換え、外部proxy、画像の見た目によるAI判定、署名の検証を伴わない「本物」判定。

## リリース条件

自動: `npm run typecheck`、`npm test`、`npm run build`、`npm run build:edge`、`npm run check:manifest`、`npm run test:browser`、`npm run test:extension`が成功すること。既存試験の保証を削除しないこと。

実機: 通常のChrome / Edgeで、正規に閲覧できる作品を使い[MANUAL_TESTS.md](MANUAL_TESTS.md)の項目を確認すること。合成HTTPの成功を実pixivの成功と数えない。PASS / FAIL / NOT RUNを分けて記録する。
