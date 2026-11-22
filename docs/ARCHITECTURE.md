# Architecture

更新: 2026-11-22。追加依存なし・バックエンドなし。MV3のAPI権限は`declarativeNetRequestWithHostAccess`だけ（原寸取得のReferer用）。

## 構成と取得経路

```text
pixiv top frame / isolated content script / closed Shadow DOM
  ├─ app.ts      作品ページの従来パネル（ページ選択・ローカル読込）、共有ticker、共有cooldown
  └─ preview.ts  イベント委譲のhover/focus、フローティングプレビュー
       ├─ 250ms後、その作品だけ  GET /ajax/illust/{id}/pages   (same-origin session, redirect:error)
       │    └─ artworks.ts: 1 MiB / 15秒 / スキーマ / 原寸・縮小URL・ページ順の検証
       ├─ <img src=regular srcset="small 540w, regular 1200w">  表示専用（p0は元サムネイルも可）
       ├─ wheel / 前後 / 左右キー → 表示ページだけ切替（取得・解析しない）
       ├─ Metadataクリック → {type, requestId, artworkId, page, url, contextUrl?}
       │    └─ runtime.sendMessage → MV3 service worker (inspector.ts)
       │         自拡張 / frame 0 / tab ID / pixiv origin / 現在URL（取得前後）
       │         原寸URLのhost・path・作品ID・ページ / 全タブ1枠 / 429 cooldown
       │         fetch(credentials:omit, referrerPolicy:no-referrer, redirect:error)
       │           + session rule: Referer: https://www.pixiv.net/（この拡張・タブなし・GET・img-originalのみ）
       │         15秒 / 実受信48 MiB / MIME + magic → inspectImage → JSON互換の結果
       └─ ファイル選択 → inspectLocalFile → 同じ inspectImage（作品とは関連付けない）

inspectImage (src/metadata, pixiv/UIから独立)
  PNG → png.ts（構造・CRC・tEXt/zTXt/iTXt）→ stealth.ts（アルファLSB）→ normalize.ts（分類）
  JPEG/WebP → exif.ts（APP1 / RIFF EXIF → TIFF → 文字列タグ）→ normalize.ts
```

表示と解析は別経路です。`<img>`はページの通常の表示条件（ブラウザ既定のReferrer-Policy）に従い、拡張はページの通信を変更しません。Workerの原寸取得はCookieを付けず、pixivのRefererだけを付けます。

## 原寸取得とReferer（実測と方針）

2026-11-19の実測（[証跡](evidence/live-layers-2026-11-19.json)）:

- 自動ブラウザ（ヘッドレスChromium・新規プロファイル）のdocumentはHTTP 403で、`cf-mitigated: challenge`のCloudflare確認画面でした。拡張の不具合ではなく、自動化プロファイルへの確認画面です。突破は試みていません。
- 通常のHTTPクライアントではdocument 200、pages APIは200で、URL形状は検証器と一致しました。
- 原寸・縮小とも、Cookie・Refererなし（Workerと同じ条件）の要求には**403**でした。pixivのページはReferrer-Policyを指定していないため、ページ上の`<img>`はブラウザ既定で`Referer: https://www.pixiv.net/`を送ります。

2026-11-22の実測（[証跡](evidence/live-referer-2026-11-22.json)）:

- 同じ原寸に、Cookieなし・`Referer: https://www.pixiv.net/`ありで要求すると**200（image/jpeg）**でした。403の原因はRefererです。応答に`Access-Control-Allow-Origin`はありません。
- 本番ビルドをChromium 156に読み込み、Service Workerから製品と同じ条件で取得すると、セッションルールが適用されて**200**になりました。同じ原寸を通常のタブの`<img>`で読むと失敗します。ルールがページの通信に及ばないことも確認済みです。

方針（メンテナー決定、2026-11-22、Issue #9）: PixivBatchDownloaderの方式（declarativeNetRequestでi.pximg.netへの全要求にRefererを設定し、応答の`Access-Control-Allow-Origin`を`*`に書き換える）に倣いつつ、範囲を絞りました。

- `src/network/referer-rule.ts`のセッションルール1件で、`Referer: https://www.pixiv.net/`を付けます。対象は、この拡張が開始した要求（initiator = 拡張ID）で、タブに属さず（Service Worker）、GETで、`https://i.pximg.net/img-original/`への要求だけです。
- 応答ヘッダー（CORS）は書き換えません。Workerはホスト権限があるためCORSの制約を受けません。他サイトやpixivのページの通信、Cookie、その他のヘッダーは変更しません。
- 取得は従来どおり、クリック時の1枚・全タブで1件・再試行なし・先読みなしです。ルールの導入に失敗しても致命的ではありません（取得は403となり、理由を表示します）。
- PixivBatchDownloader（GPL-3.0-or-later）のコードはコピーしていません。標準APIでの独自実装です。

それ以前（2026-11-19〜21）はReferer付与を行わない方針で、Metadataは実pixivで403になる想定でした。

## 信頼境界

- **サムネイル検出**（thumbnail.ts）: 正規の作品リンク（`/artworks/{id}`）を起点に、ホバーした画像 → リンク内の画像（最大8件）→ オーバーレイ型カード（リンクの親要素直下の画像）の順に探します。画像URLが同じ作品IDのp0のpximg縮小画像である場合だけ採用します。作品リンクの外にある画像を推測で関連付けることはしません。作者名は`li`/`article`内の、文字を含む最初のユーザーリンクだけです。
- **ページ一覧**（artworks.ts）: 構造が違う要素はページ番号を守るため一覧ごと拒否します。認識できる原寸URLで作品・ページが不一致の場合も拒否します。i.pximg.netの未知のパス・拡張子（GIF・うごイラ等）はそのページだけを「検査対象外」にし、プレビューは残します。`error:true`や4xxのJSONでは、pixivのメッセージをプレーンテキスト（200字、制御文字除去）として表示します。
- **Worker**（inspector.ts）: 送信元・スキーマ・URLを独立に再検証します。作品パネルの要求は現在タブの作品IDに、ホバーの要求はクリック時の完全なURL（`contextUrl`）に結び付け、取得前後に`tabs.get`で照合します。ナビゲーション・タブ終了で中止します。全タブ1枠は最初のawaitより前に確保し、本文読込・解析が終わるまで解放しません。非同期応答は`return true` + `sendResponse`です。
- 汎用fetch、page `postMessage`の橋、任意DOM属性による認可はありません。

## 解析

- **PNGテキスト**（png.ts）: シグネチャ、IHDR/PLTE/IDAT/IEND の順序、CRC、未知の必須チャンク、キーワード規則、Latin-1/UTF-8（BOMを保持）、zlibの上限付き展開、重複キー（RAWに保持し判定から除外）。IDATは展開しません。
- **Stealth**（stealth.ts）: NovelAI公式`nai_meta.py`と同じく、アルファのLSBを**列優先**で読み、MSB優先でバイト化します。`stealth_pngcomp`（15バイト）+ ビット長（uint32 BE）+ gzip(JSON)。8-bit・非インターレースのRGBA / グレー+アルファだけを、IDATを4 KiBずつ展開しながら1行ずつ逆フィルタして読みます。画像の高さが120px以上なら先頭120行でmagicの有無が決まるため、Stealthのない画像はそこで終了します。アルファのない画像は`not-present`、16-bit・インターレース・パレット+tRNSは`not-checked`です。非圧縮の`stealth_pnginfo`は検出のみで、内容は読みません。
- **EXIF**（exif.ts）: JPEGはSOSまでのAPP1 `Exif\0\0`、WebPは最初の`EXIF`チャンク（`Exif\0\0`前置ありにも対応）。TIFFのIFD0（ImageDescription/Make/Model/Software/Artist）とExif IFDのUserComment（UNICODEはTIFFのバイト順、ASCII、JIS、未定義）だけを読みます。ComfyUIの`prompt:`/`workflow:`はIFD0の0x0100–0x0110だけで認識します。
- **分類**（normalize.ts）: NovelAIはSoftwareの自己申告が前提です（Description、Source、Comment、1段のComment envelope、V4/V4.5の`v4_prompt`/`v4_negative_prompt`は公式APIスキーマに一致する場合だけ）。ComfyUIはノード構造、A1111/Forgeは最終行の`Steps:`形式です。PNGテキストとStealthの両方がある場合はテキスト側を表示し、Stealthにだけある項目を補い、値の不一致は注記します。
- **判定の語彙**: `metadata-indicates`（メタデータから推定）。署名は`not-checked`（記載あり・未検証）/`not-present`。`verified`/`invalid`を生成する実装はありません。
- **上限**: 48 MiB、40百万画素、4096チャンク、テキスト128件・2 MiB、JSON深さ64・50,000値、Stealth圧縮1 MiB・展開2 MiB、Stealthキー128、EXIF IFD 512項目。

## ライフサイクル・負荷

- DOM全体の走査・MutationObserverはありません。mouseover/out、focusin/outを委譲で受けます。ホバー250ms、離脱200ms。
- 300msの**共有ticker**は1本だけ（従来パネルとプレビューで共用）です。URL確認、キャッシュ失効、対象要素の接続確認、ページに消されたホストの再接続だけを行い、通信はしません。Navigation APIの`currententrychange`と`visibilitychange`でも即時に実行します。非表示タブのtimerはブラウザが間引きます。
- scroll/resizeによる再配置はrequestAnimationFrameで1フレーム1回です。
- 別作品・ページ切替・SPA遷移・close・BFCacheで古い作業をabortし、世代の違う結果は捨てます。元リンクは書き換えません。
- フォーカス中のボタンが処理中に無効化されたら、フォーカスをパネルに移します（`<body>`に落とさない）。Escapeは常に閉じますが、フォーカスがページ側の入力欄などにあるときはイベントを止めません。
- pages APIは従来パネルとhoverで共用し、タブ内で直列化します。中止された待機は取得しません。429はRetry-After（秒/日付、60秒〜24時間）を尊重します。原寸の429はWorkerとタブの両方で待機します（MV3 Workerは再起動で状態を失うため）。
- `MemoryCache`: LRU + 2分TTL。一覧24件/推定2 MiB、結果8件/推定8 MiB（UTF-16 JSON長による保守的な推定）。上限を超える単一結果は表示だけします。

## テスト境界

- Vitest: 解析器（参照fixtureを含む）、URL/認可、Worker、DOM競合、キャッシュ、wheel、UI表示。
- `test:browser`: テスト用アダプタ（open shadow root）と合成ページ・合成HTTP。
- `test:extension`: 本番ビルドのMV3（closed root、実runtime messaging、Worker）を使い捨てプロファイルで実行。すべての通信は合成応答です。
- 参照fixture: NovelAI公式の書込み・読込み、ComfyUI・AUTOMATIC1111の未改変関数で作った合成画像（[tests/reference/README.md](../tests/reference/README.md)）。

実サイトの確認状況は[TEST_STATUS.md](TEST_STATUS.md)と[MANUAL_TESTS.md](MANUAL_TESTS.md)を参照してください。
