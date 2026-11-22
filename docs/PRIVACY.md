# プライバシー説明 / Privacy

対象: 開発版 0.1.x（2026-11-19時点の実装）

この拡張は、ユーザーが閲覧中のpixivで選んだ作品・ページ、またはユーザーが明示的に選んだローカルファイルだけを扱います。

## 通信

| いつ | 何を | どこへ | 付加情報 |
|---|---|---|---|
| サムネイルに約250msホバー／フォーカス | その作品のページ一覧（`/ajax/illust/{id}/pages`） | www.pixiv.net | ブラウザの通常の同一オリジンセッション（拡張はCookieを読みません） |
| プレビュー表示 | APIまたはページ上の縮小画像を通常の`<img>`で表示 | i.pximg.net | ブラウザの通常の画像表示と同じ |
| **Metadata／元画像を検査**を押したとき | 表示中ページの原寸画像1枚 | i.pximg.net | 認証情報（Cookie）なし。固定値の`Referer: https://www.pixiv.net/`だけを付ける（画像配信サーバーが要求するため）。リダイレクトは追跡しない |

- 接続先はpixivとpximgだけです。通常の通信と同様、接続先にはIPアドレス等が伝わります。
- 画像、Prompt、生成設定、RAW、ローカルファイルの内容やファイル名を外部へ送信しません。テレメトリー・広告・解析SDK・追跡ライブラリはありません。
- 一覧の巡回、原寸の先読み、自動再試行、ログイン・年齢制限・ホットリンク制限・レート制限の回避は行いません。

## 端末内の処理と保存

- 画像の解析（PNGテキスト、Stealth、EXIF）はすべて端末内で行います。
- ページ一覧（最大24件・推定2 MiB）と検査結果（最大8件・推定8 MiB）を、タブ内のメモリにだけ最長2分保持します。ページ移動・BFCache・タブを閉じたときに消去します。表示中の結果は、次の検査やページ移動まで画面に残る場合があります。
- 原寸のバイト列はキャッシュしません。localStorage・拡張ストレージ・IndexedDB・ファイルへの保存はありません。
- 画像表示ではブラウザの通常のHTTPキャッシュが使われる場合があります。
- ローカルファイルの結果は、表示中の作品と同じ画像だと仮定せず、作品の結果キャッシュにも入れません。

## 権限

- API権限: `declarativeNetRequestWithHostAccess`だけです。拡張自身が行う原寸画像の取得1件にpixivのRefererを付けるためにだけ使います。pixivのページや他のサイトの通信、応答ヘッダーは変更しません。cookies / tabs / storage / webRequest などは要求しません。
- ホスト権限: `https://www.pixiv.net/*`（コンテンツスクリプトとタブURLの確認）、`https://i.pximg.net/*`（原寸画像の取得）。
- 他のサイト、閲覧履歴、Cookie、保存されたパスワードは読みません。

## クリップボード

コピーはボタンを押したときだけです。「正規化JSONをコピー」にはRAWテキストと解析対象URL（またはファイル名）が含まれます。クリップボードの履歴・同期はOSとブラウザの設定に従います。

## English

The extension talks only to www.pixiv.net (page list on hover, using the browser's normal same-origin session) and i.pximg.net (preview images as ordinary `<img>`, and one original per explicit click, sent without cookies and with the fixed header `Referer: https://www.pixiv.net/` that the image server requires). All parsing is local. Nothing is uploaded, no telemetry exists, and nothing is persisted: results are kept in tab memory for at most two minutes. Its only API permission is `declarativeNetRequestWithHostAccess`, used solely for that Referer on its own original request. It requests no hosts other than these two and never reads cookies, history or passwords.

Contact: see [SECURITY.md](../SECURITY.md).
