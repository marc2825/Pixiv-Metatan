# 設計

2026-11-22時点。npmの依存はすべて開発用で、バックエンドもありません。MV3のAPI権限は、原寸取得にRefererを付けるための `declarativeNetRequestWithHostAccess` だけです。

## 全体の流れ

```text
pixiv top frame / isolated content script / closed Shadow DOM
  ├─ app.ts      作品ページのパネル（ページ選択・ローカル読込）、共有ticker、共有cooldown
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

ツールバーのアイコン → action.onClicked → tabs.create(inspector.html)（拡張ページ・通信なし）
  └─ local-inspector.ts: ファイル選択 / ドラッグ＆ドロップ → inspectLocalFile → renderResult（同じ実装を共用）

inspectImage (src/metadata, pixiv/UIから独立)
  PNG → png.ts（構造・CRC・tEXt/zTXt/iTXt）→ stealth.ts（アルファLSB）→ normalize.ts（分類）
  JPEG/WebP → exif.ts（APP1 / RIFF EXIF → TIFF → 文字列タグ）→ normalize.ts
```

表示と解析は別の経路です。プレビューの `<img>` は、ページの通常の画像と同じ条件（ブラウザ既定のReferrer-Policy）で読み込まれ、拡張はページの通信に手を加えません。Service Workerの原寸取得は、Cookieなしで、pixivのRefererだけを付けます。

## 原寸取得とReferer

### 2026-11-19の測定

[証跡](evidence/live-layers-2026-11-19.json)

- ヘッドレスChromium（新しいプロファイル）でページを開くと403になり、`cf-mitigated: challenge` のCloudflareの確認画面が出ました。自動化したブラウザに対する確認で、拡張の不具合ではありません。突破は試みていません。
- 通常のHTTPクライアントでは、ページが200、pages APIが200で、URLの形は検証処理と一致しました。
- 原寸も縮小画像も、CookieとRefererなし（Service Workerと同じ条件）で要求すると403でした。pixivのページはReferrer-Policyを指定していないので、ページの `<img>` はブラウザ既定で `Referer: https://www.pixiv.net/` を送っています。

### 2026-11-22の測定

[証跡](evidence/live-referer-2026-11-22.json)

- 同じ原寸を、Cookieなし・`Referer: https://www.pixiv.net/` ありで要求すると200（image/jpeg）でした。403の原因はRefererです。レスポンスに `Access-Control-Allow-Origin` はありません。
- 本番ビルドをChromium 156に読み込み、Service Workerから製品と同じ条件で取得すると、セッションルールが効いて200になりました。
- 同じ原寸を通常のタブの `<img>` で読むと失敗しました。ルールがページの通信に効いていないことも、これで確かめています。

### 方針

2026-11-22にメンテナーが決定（Issue #9）。

PixivBatchDownloaderは、declarativeNetRequestでi.pximg.netへのすべての要求にRefererを付け、レスポンスの `Access-Control-Allow-Origin` を `*` に書き換えています。この方式にならいつつ、範囲を絞りました。

- `src/network/referer-rule.ts` のセッションルール1つで、`Referer: https://www.pixiv.net/` を付けます。
  - 対象: この拡張が始めた要求（initiator = 拡張ID）で、タブに属さず（Service Worker）、GETで、`https://i.pximg.net/img-original/` へのもの。
- 変えないもの:
  - レスポンスのヘッダー（CORS）。Service Workerはホスト権限を持つので、CORSの制約を受けません。
  - 他のサイトやpixivのページの通信、Cookie、その他のヘッダー。
- 取得の条件は今までどおりです: クリックしたときに1枚、全タブで1件まで、再試行なし、先読みなし。
- ルールの登録に失敗しても止まりはしません。取得が403になり、その理由を表示します。
- PixivBatchDownloader（GPL-3.0-or-later）のコードはコピーしておらず、標準のAPIで書いています。

2026-11-19〜21はRefererを付けない方針で、実際のpixivではMetadataが403になる前提でした。

## 信頼の境界

### サムネイルの検出（thumbnail.ts）

正しい作品リンク（`/artworks/{id}`）から探し始めます。探す順は次のとおりです。

1. カーソルを合わせた画像
2. リンクの中の画像（8枚まで）
3. 画像の上にリンクが重なったカード（リンクの親要素の直下の画像）

画像のURLが同じ作品IDのp0のpximg縮小画像である場合だけ採用し、作品リンクの外の画像を推測で結び付けることはしません。作者名は、`li` か `article` の中の、文字のある最初のユーザーリンクから取ります。

### ページ一覧（artworks.ts）

- 構造のおかしい要素が1つでもあれば、ページ番号がずれないよう一覧ごと断ります。原寸URLの作品IDやページ番号が合わないときも同じです。
- i.pximg.netの知らないパスや拡張子（GIF、うごイラなど）は、そのページだけを「検査対象外」にし、プレビューは残します。
- `error:true` や4xxのJSONが返ったら、pixivのメッセージをプレーンテキストで表示します。200字までで、制御文字は取り除きます。

### Service Worker（inspector.ts）

- 送信元、メッセージの形、URLを、コンテンツスクリプトとは別にもう一度確かめます。
- 依頼をタブの状態と結び付け、取得の前後に `tabs.get` で照らし合わせます。
  - 作品ページのパネルからの依頼: タブの現在の作品ID。
  - プレビューからの依頼: クリックしたときのURLそのもの（`contextUrl`）。
- ページを移ったりタブを閉じたりしたら中止します。
- 全タブで1枠の取得枠は、最初の `await` より前に押さえ、本文の読み込みと解析が終わるまで手放しません。
- 非同期の応答は `return true` と `sendResponse` で返します。

なんでも取得できるfetch、ページの `postMessage` とのつなぎ、DOMの属性による認可は、どれもありません。

## 解析

### PNGのテキスト（png.ts）

- 確かめること: シグネチャ、IHDR / PLTE / IDAT / IENDの順序、CRC、知らない必須チャンク、キーワードの規則。
- 文字コード: Latin-1とUTF-8（UTF-8の先頭のBOMは残します）。
- zlibは上限を付けて展開します。IDATは展開しません。
- キーが重複したら、生データには残しますが、判定には使いません。

### Stealth形式（stealth.ts）

- ビットの読み方はNovelAI公式の `nai_meta.py` と同じです。アルファの最下位ビットを列の順に読み、上位ビットから詰めてバイトにします。
- データの並び: `stealth_pngcomp`（15バイト）、ビット長（uint32、ビッグエンディアン）、gzipしたJSON。
- 読む画像: 8ビット・非インターレースのRGBAとグレー+アルファ。IDATを4 KiBずつ展開し、1行ずつフィルタを戻しながら読みます。
- 高さが120px以上なら、先頭の120行で目印の有無が決まります。Stealthのない画像はそこでやめます。
- 画像の種類ごとの扱い:
  - アルファのない画像: `not-present`
  - 16ビット、インターレース、パレット+tRNS: `not-checked`
- 圧縮しない `stealth_pnginfo` は、あることだけ検出し、中身は読みません。

### EXIF（exif.ts）

- EXIFの場所:
  - JPEG: SOSより前のAPP1 `Exif\0\0`
  - WebP: 最初の `EXIF` チャンク（前に `Exif\0\0` が付いていても読みます）
- 読むタグは次の2種類だけです。
  - TIFFのIFD0: ImageDescription、Make、Model、Software、Artist
  - Exif IFD: UserComment。UNICODE（TIFFのバイト順）、ASCII、JIS、未定義に対応します。
- 検証:
  - IFDの件数と各エントリのヘッダーは、いつも確かめます。
  - 値のサイズとオフセットは、読む対象のタグだけ確かめます。関係のないタグ（大きなMakerNoteなど）は読まずに飛ばし、対象のタグがおかしければ今までどおり断ります。
  - 対象のタグが重複していたら、最初の値で判定し、注記を出します。
- ComfyUIの `prompt:` / `workflow:` は、IFD0の0x0100〜0x0110にあるときだけ認めます。

### 分類（normalize.ts）

- NovelAI: Softwareの自己申告がある場合だけ認めます。読むのは、Description、Source、Comment、1段のComment envelope、V4 / V4.5の `v4_prompt` / `v4_negative_prompt` です。V4のものは公式APIの形式に合う場合だけ読みます。
- ComfyUI: ノードの構造で判断します。
- A1111 / Forge: 最終行の `Steps:` の形で判断します。
- PNGのテキストとStealthの両方があるとき:
  - 表示するのはテキストの方です。
  - Stealthにしかない項目は補います。
  - 値が食い違えば注記します。

### 判定の言葉

- 内容は `metadata-indicates`（メタデータから推定）として示します。
- 署名は `not-checked`（記載はあるが未検証）か `not-present` です。
- `verified` や `invalid` を出す実装はありません。

### 上限

| 対象 | 上限 |
|---|---|
| ファイル | 48 MiB |
| 画素数 | 4,000万 |
| PNGのチャンク | 4096個 |
| テキスト | 128件、2 MiB |
| JSON | 深さ64、値50,000 |
| Stealth | 圧縮1 MiB、1行1 MiB、展開後2 MiB、キー128 |
| EXIF | IFDあたり512項目 |

## 動作と負荷

### イベント

- DOM全体の走査やMutationObserverは使わず、mouseover / out とfocusin / outを委譲で受けます。
- ホバーして250ミリ秒で開き、離れて200ミリ秒で閉じます。

### 定期処理

- 300ミリ秒ごとの見回り（ticker）は1本だけで、パネルとプレビューで共有します。
  - 行うこと: URLの確認、キャッシュの期限切れ、対象要素がまだページにあるかの確認、ページに消されたホスト要素の付け直し。通信はしません。
  - Navigation APIの `currententrychange` と `visibilitychange` でもすぐに動きます。
  - 非表示のタブでは、ブラウザがタイマーを間引きます。
- スクロールやリサイズでの位置合わせは、requestAnimationFrameで1フレームに1回までです。

### 中止とフォーカス

- 別の作品、ページの切り替え、SPAでの移動、閉じたとき、BFCacheに入ったときは、古い処理を中止し、世代の違う結果は捨てます。元のリンクは書き換えません。
- フォーカスのあるボタンが処理中に無効になったら、フォーカスをパネルに移します（`<body>` に落としません）。
- Escはいつでも閉じますが、ページ側の入力欄などにフォーカスがあるときはイベントを止めません。

### ページ一覧の取得（page-store.ts）

pages APIは、パネルとプレビューで共有する `page-store.ts` を通して取得します。

- 待っている呼び出しがある取得は、タブの中で1件ずつ行います。同じ作品への要求は1つにまとめます。
- カーソルがカードを離れても、送ってしまった要求は最後まで受け取ってキャッシュに入れます。送ったあとで中止してもサーバーの負荷は減らず、戻ったときにもう一度取りにいくことになるからです。
  - こうした取得は1件まで、同時の通信は2件までです。
  - まだ送っていない待ちは、中止したら捨てます。
- サムネイルを次々になぞっているとき（前のプレビューから1秒以内に次を開いたとき）は、ページ一覧の取得を150ミリ秒遅らせます。
  - その時点でポインターやフォーカスがカードにもプレビューにもなければ取得せず、戻ってきたときに遅らせずに取得します。
  - キャッシュ済みの作品はすぐ表示します。
  - サムネイルはいつもすぐ表示します。
- 効果は合成ベンチマーク（`tests/pages-traffic.test.ts`）で固定しています。

### 429とキャッシュ

- 429では `Retry-After`（秒数か日付。60秒〜24時間）に従います。
- 原寸の429では、Service Workerとタブの両方で待ちます。MV3のService Workerは、再起動すると状態を失うからです。
- `MemoryCache` はLRUで、期限は2分です。

  | 対象 | 件数 | 推定サイズ |
  |---|---|---|
  | ページ一覧 | 24件 | 2 MiB |
  | 結果 | 8件 | 8 MiB |

  - サイズは、UTF-16のJSONの長さで多めに見積もります。
  - 上限を超える大きな結果は、表示だけしてキャッシュしません。

## テストの範囲

- Vitest: 解析（参照fixtureを含む）、URLと認可、Service Worker、DOMでの競合、キャッシュ、ホイール、表示。
- `test:browser`: テスト用のアダプタ（open shadow root）で、合成ページと合成HTTPを使います。
- `test:extension`: 本番ビルドのMV3（closed root、実際のruntime messaging、Service Worker）を使い捨てのプロファイルで動かします。通信はすべて合成の応答です。
- 参照fixture: NovelAI公式の書き込み・読み取り処理と、ComfyUI・AUTOMATIC1111の変更していない関数で作った合成画像です（[tests/reference/README.md](../tests/reference/README.md)）。

実際のサイトでの確認状況は、[TEST_STATUS.md](TEST_STATUS.md)と[MANUAL_TESTS.md](MANUAL_TESTS.md)にあります。
