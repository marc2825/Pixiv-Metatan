# プライバシー

開発版 0.1.x（2026-11-22時点）の説明です。

この拡張が扱うのは、pixivでユーザーが選んだ作品のページと、ユーザーが自分で選んだ画像ファイルだけです。

## 通信するとき

| きっかけ | 取得するもの | 接続先 |
|---|---|---|
| サムネイルに0.25秒ほどカーソルを合わせる（またはフォーカスする） | その作品のページ一覧（`/ajax/illust/{id}/pages`） | www.pixiv.net |
| プレビューの表示 | 縮小画像。ページ内の通常の `<img>` として表示 | i.pximg.net |
| 「Metadata」または「元画像を検査」を押す | 表示中のページの原寸画像1枚 | i.pximg.net |

- ページ一覧は、pixivのページと同じ通常のセッションで取得します。拡張がCookieを読むことはありません。
- 原寸画像にはCookieを付けません。画像サーバーが求める `Referer: https://www.pixiv.net/` だけを付けます。リダイレクトには従いません。
- 接続先はこの2つだけです。ふつうの通信と同じく、接続先にはIPアドレスなどが伝わります。
- 画像、プロンプト、生成設定、ファイルの中身やファイル名を外部に送ることはありません。利用状況の送信、広告、解析ツールもありません。
- 一覧の自動巡回、原寸の先読み、自動の再試行はしません。

## 端末の中での処理と保存

- 画像の解析（PNGのテキスト情報、Stealth形式、EXIF）はすべて端末の中で行います。
- ページ一覧（最大24件、約2 MiB）と検査結果（最大8件、約8 MiB）は、そのタブのメモリに最大2分置いておきます。別のページに移ったとき、戻る・進むでページを離れたとき、タブを閉じたときに消えます。画面に出ている結果は、次の検査やページの移動まで残ることがあります。
- 原寸画像のデータはキャッシュしません。localStorage、拡張機能のストレージ、IndexedDB、ファイルには何も保存しません。
- 画像の表示には、ブラウザ自体のHTTPキャッシュが使われることがあります。
- 拡張機能のアイコンから開く検査ページ（`inspector.html`）は、選んだりドロップしたりしたファイルを端末の中で解析するだけで、通信はしません。
- 手元のファイルの結果は、表示中の作品と同じ画像だとはみなさず、作品の結果としても保存しません。

## 権限

- `declarativeNetRequestWithHostAccess`: 原寸画像を取得するときにRefererを付けるためだけに使います。pixivのページや他のサイトの通信、レスポンスのヘッダーは変えません。cookies、tabs、storage、webRequestなどの権限は求めません。
- `https://www.pixiv.net/*`: pixivのページで動くため、タブのURLを確かめるため。
- `https://i.pximg.net/*`: 原寸画像を取得するため。

他のサイト、閲覧履歴、Cookie、保存されたパスワードは読みません。

## クリップボード

コピーはボタンを押したときだけです。「正規化JSONをコピー」でコピーされる内容には、メタデータの生のテキストと、画像のURL（手元のファイルならファイル名）が含まれます。クリップボードの履歴や同期は、OSとブラウザの設定によります。

## English

The extension connects only to www.pixiv.net and i.pximg.net. When you hover over a thumbnail, it requests that artwork's page list using your normal pixiv session. Previews load as ordinary `<img>` elements. Pressing **Metadata** fetches one original image without cookies. That request carries `Referer: https://www.pixiv.net/` because the image server requires it.

All parsing happens on your device. Nothing is uploaded, and there is no telemetry. Results stay in tab memory for at most two minutes, and nothing is written to disk. The only API permission is `declarativeNetRequestWithHostAccess`, used only for that Referer. The extension never reads cookies, history or passwords.

Contact: see [SECURITY.md](../SECURITY.md).
