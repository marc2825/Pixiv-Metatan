# セキュリティ

## 対象のバージョン

まだリリース前の開発版（0.1.x）です。修正は `main` ブランチに入れます。

## 脆弱性の報告

脆弱性の詳細は、公開のIssueに書かないでください。

1. リポジトリの「Security」タブにある「Report a vulnerability」から、非公開で報告してください。
2. うまく使えない場合は、「Security contact request」という題名で、詳細を書かずにIssueを立ててください。非公開でやり取りする方法をこちらから連絡します。

再現手順には、自分で作った最小限のデータ（生成したPNGなど）を使ってください。他の人の作品画像やプロンプト、Cookie、トークン、HARファイル、R18の画像は含めないでください。7日以内に返事をします。

## 守っている境界

### 検査を頼めるもの

検査を頼めるのは、`https://www.pixiv.net` のトップフレームで動くこの拡張自身のコンテンツスクリプトだけです。

- Service Workerは、取得の前後に次の項目を確かめます: 拡張ID、フレーム番号0、タブID、pixivのオリジン、メッセージの形式、タブの現在のURL。
- 作品ページの「生成情報」ボタンから開いたときの依頼は、タブに表示中の作品IDと照らし合わせます。プレビューからの依頼は、押したときのページURLと完全に一致することを求めます。
- ページのスクリプト（`postMessage`）からService Workerには届きません。外部からのメッセージも受け付けません。
- どんなメッセージを送っても、任意のURLを取得させることはできません。

### 取得するもの

- ホバーしたとき: 同じオリジンのページ一覧API（コンテンツスクリプトから）と、通常の `<img>` で表示する縮小画像。
- 押したとき: 原寸画像1枚。Service Workerが取得します。
  - URLは `https://i.pximg.net/img-original/img/…/{id}_p{page}.{png|jpg|jpeg|webp}` の形で、作品IDとページ番号が一致するものに限ります。
  - URLを組み立てることはしません。
  - ホスト、スキーム、ポート、ユーザー情報、クエリ、フラグメント、正規化後の形を厳密に確かめます。

### 原寸画像の取得方法

- `fetch` の設定は `credentials: 'omit'`、`referrerPolicy: 'no-referrer'`、`redirect: 'error'` です。
- その他の決まり:
  - 15秒で打ち切ります。
  - すべてのタブを合わせて同時に1件までです。
  - MIMEタイプと先頭バイトを確かめます。
  - 読み込みながら48 MiBの上限をかけます。
  - 依頼ごとに取り消せます。
- i.pximg.netはpixivのRefererを求めるので、declarativeNetRequestのセッションルールを1つだけ使い、この取得に `Referer: https://www.pixiv.net/` を付けます（2026-11-22にメンテナーが決定、issue #9）。
  - ルールが効くのは、送信元がこの拡張で、タブに属さず、GETで、URLが `https://i.pximg.net/img-original/` で始まるリクエストだけです。
  - レスポンスのヘッダーは変えません。CORSの書き換えもしません。
  - Cookieは付けません。
  - pixivのページ、他のサイト、他の拡張の通信には影響しません。
- HTTP 429が返ったときは、Service Workerとタブの両方で待機に入ります。待つ時間は `Retry-After` に従い、最低60秒です。
- 自動の再試行、Cookieの読み取り、プロキシ、一括ダウンロードはしません。

### 解析

- PNG:
  - 構造とCRCを確かめます。
  - チャンクは4096個まで、テキストは128件・合計2 MiBまでです。
  - zlib / gzipの展開量に上限があります。
  - 画像は4,000万画素までです。
- JSON: 深さ64、値の数50,000までです。
- Stealth形式:
  - 8ビット・非インターレースのアルファ付き画像だけを読みます。
  - 1行のデータが1 MiBを超える画像は、メモリを確保する前に断ります。
  - 埋め込みがなければ、先頭の目印の行を読んだところでやめます。
  - 圧縮データは1 MiBまでです。
- EXIF:
  - IFDの数とエントリのヘッダーに上限があります。
  - オフセットとサイズは、読み取り対象のテキスト用タグについてだけ確かめます。関係のないタグやメーカー独自のタグは読み飛ばし、対象のタグが壊れていたら失敗として扱います。
- `__proto__` のようなキーも、ただのデータとして扱います。

### 手元のファイルの検査ページ

ツールバーのアイコンを押すと、拡張のページ `inspector.html` を `tabs.create` で開きます。この方法なら権限は要りません。このページは選ばれたファイルを端末の中で1枚ずつ解析するだけで、通信はしません。一覧は20枚までです。選んだ画像は、このページの中だけで使えるobject URLで表示し、一覧から消すかページを閉じると破棄します。pixivのページの中ではobject URLを作りません（静的ガードで確かめています）。ページの外に落とされたファイルを、ブラウザが開いてしまうことも防ぎます。

### 表示

- 信頼できないテキストはすべて `textContent` で表示します。
  - pixivのページの中では、closedのShadow Rootに入れます。
  - 拡張自身の検査ページではopenです。
- 生データの表示は、開いたときに作られ、読み取り専用です。
- アイコンは、DOMの操作で組み立てるSVGです。マークアップの文字列は使いません。
- クリップボードへの書き込みは、ボタンを押したときだけです。

### 判定

- 署名の文字列は「未検証の申告」として扱います。
  - この版が `verified` や `invalid` を出すことはありません。
- メタデータがないことを、人が描いた証拠として示すことはありません。

### 保存

- キャッシュはタブのメモリの中だけに置きます。期限と件数に上限があります。
- キャッシュが消えるのは次のときです: ページの移動、BFCacheに入るとき、終了時。
- 手元のファイルは作品と結び付けず、作品の結果としてキャッシュもしません。

### 権限

- API権限は `declarativeNetRequestWithHostAccess` だけです。
  - 上のRefererのルールのために使います。
  - インストール時に追加の警告は出ません。
- ホスト権限は `www.pixiv.net` と `i.pximg.net` だけです。

## 自動のチェック

- `npm run check:manifest`: ビルドしたマニフェストを検査します（ルールは `scripts/manifest-policy.ts` にあり、合成したマニフェストでテストしています）。次のどれかに当てはまると失敗します。
  - 権限、ホスト、外部への公開設定が上の範囲を超えている。
  - コンテンツスクリプトが次の条件を満たしていない: pixiv向けでトップフレームのみ、isolated world、JSファイル1つ、全体で1つ。
  - backgroundがService Worker 1つになっていない。
- `tests/static-guards.test.ts`: 拡張のコードに次のものが入ると失敗します。
  - HTMLを差し込む処理。
  - storageやcookieのAPI、その他の通信API、外部からのメッセージ受信、新しいホスト（SVGの名前空間URIは、アイコンのファイルに限って除外）。
  - 検査ページ以外でのobject URLの作成。
  - 原寸取得の設定の変更。
  - 上のRefererのルール以外でのdeclarativeNetRequestの使用。
- CI（`.github/workflows/ci.yml`）は、読み取り専用のトークンだけで動き、シークレットは使いません。CIでは次のものも実行します。
  - `npm audit --audit-level=high`
  - gitleaksによる全履歴のスキャン。バイナリはバージョンを固定し、チェックサムを確かめています。出力では秘密の値を伏せます。

自動テストは、生成した画像と横取りした通信だけで行います。詳しくは[検証状況](docs/TEST_STATUS.md)と[手動での確認手順](docs/MANUAL_TESTS.md)をご覧ください。

## English

Please report vulnerabilities privately through **Security → Report a vulnerability**. If that doesn't work for you, open an issue titled "Security contact request" with no details, and the maintainer will set up a private channel. Use synthetic reproductions only, with no real artwork, cookies, tokens, HAR files or R18 content. You can expect a reply within 7 days. Fixes go to `main`, since there is no release yet.
