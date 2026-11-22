# 実機確認手順

更新: 2026-11-19。合成ページの成功と実pixivでの成功を分けて記録します。現状は[TEST_STATUS.md](TEST_STATUS.md)。

自動ブラウザ（Playwright）は、pixivのdocumentでCloudflareの確認画面（HTTP 403、`cf-mitigated: challenge`）になります。確認画面を自動で突破することはしないため、実一覧の確認は**人が通常のブラウザで行います**。

## 準備

1. [README](../README.md#インストール開発版)の手順で、開発用のChrome / Edgeプロファイルに拡張を読み込みます。必要なら通常のログイン画面からログインします。Cookieやトークンのコピーはしません。
2. 正規に閲覧できる単一画像・複数画像の作品を用意します（自作・権利処理済みが望ましい）。作品の投稿や公開範囲の変更はユーザーが判断します。
3. DevToolsのNetworkタブを開き、`ajax/illust`と`i.pximg.net`で絞り込みます。記録するのはstatus・MIME・件数だけです。

## 確認項目

1. **一覧での検出**: 検索・ランキング・ユーザーの投稿・ブックマーク・フォロー新着・作品ページの関連作品で、サムネイルにホバーします。250ms未満では何も取得せず、長いホバーでその作品の`/ajax/illust/{id}/pages`だけが1回呼ばれること。一覧を素早く横断したときは、通り過ぎたカードの多くで取得が省略され、同じカードへ戻ったときは再取得されないこと（Networkタブの件数を記録）。検出されないカードがあれば、DOM構造（クラス名・画像・名前を除く）を記録します。
2. **プレビュー表示**: プレビューの画像が実タブで表示されること（ページの通常の`<img>`表示）。縦横比、タイトル・作者（取得できる場合）、ページ数、「作品ページを開く」を確認します。サムネイルのクリックで通常どおり遷移すること。
3. **複数枚**: ホイール上下・連続trackpad・前後ボタン・左右キーで切り替わり、先頭/末尾で止まり、原寸を取得しないこと。単一画像では切替ボタンが隠れ、ページのスクロールを妨げないこと。GIF・うごイラのページは「検査対象外」と表示されること。
4. **Metadata**: 押したときだけ、そのページの原寸1件がWorker（Initiatorが拡張）から要求されること。要求ヘッダーの`Referer`が`https://www.pixiv.net/`で、Cookieがないこと（DevToolsのService Worker用ウィンドウで確認）。2026-11-22の実測（Workerからの取得）では200でした。結果のstatus/MIMEを記録します。あわせて、ページ側の通常の画像要求にはルールが及ばないことを確認します。
5. **ローカルファイル**: pixivの作品ページで原寸を表示してブラウザで保存し、「ローカルファイルを検査」で選択します。Prompt/Negative・設定・ComfyUI・RAW・Stealth・EXIFの表示を、独立したreader（NovelAI公式`nai_meta.py`、ExifToolなど）の結果と比べます。署名データがあっても「未検証」と表示されること。
6. **配置と操作**: 画面の四隅・スクロール・resize・狭い幅・高DPI・ライト/ダーク・Tab・作品リンクで↓キー・Escape。両方から離れると約200msで閉じ、Escape後は元リンクにフォーカスが戻ること。pixivの検索欄などにフォーカスがあるときのEscapeが、pixiv側にも届くこと。
7. **競合と寿命**: 高速ホバー・SPA遷移・カードの再利用・戻る/進む（BFCache）・2タブ・長時間表示で、古い画像や結果が混ざらないこと。全タブの原寸同時取得は1件、メモリキャッシュは最長2分で消えること。
8. **作品ページの従来パネル**: 右下`AI Metadata`、ページ選択、取消、ローカルファイル、URLにハッシュが付いても検査が中止されないこと。
9. **ローカル検査ページ**: pixivを開いていない状態で拡張機能のアイコンを押し、新しいタブの検査ページでファイル選択・ドラッグ＆ドロップ・取り消し・コピーを確認します。Networkタブに通信がないこと、ページ外へのドロップでファイルが開かれないこと。
10. **Chrome / Edge**: Chrome stable、Edge stable、可能なら最小対応版（120）で1〜9の主要項目。

429やタイムアウトを実サイトで誘発しないでください（合成試験で確認済み）。第三者の画像・Prompt・認証情報をリポジトリや証跡に保存しないでください。

## 検出されないカードを合成fixtureにする（Issue #11）

検出されないカードがあれば、DevToolsのElementsパネルでそのカード（`li`など）を選択し、Consoleで次を実行します。構造だけをクリップボードにコピーします。5桁以上の数字（作品ID・ユーザーID）は`123`に、画像URLの日付は合成値に置き換え、テキスト・属性値・クラス名・画像は含めません。結果を確認してから`tests/thumbnail.test.ts`に追加してください。

```js
copy((function shape(node, depth = 0) {
  if (!(node instanceof Element) || depth > 10) return '';
  const tag = node.tagName.toLowerCase(), synthetic = value => value.replace(/\d{5,}/g, '123').replace(/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}/g, '2026/10/22/00/00/00');
  const attrs = [];
  if (tag === 'a' && node.getAttribute('href')) attrs.push(`href="${synthetic(new URL(node.href).pathname)}"`);
  if (tag === 'img') attrs.push(`src="${synthetic(node.currentSrc || node.src).replace(/^https:\/\/(?!i\.pximg\.net\/)[^/]+/, 'https://example.invalid')}"`);
  for (const name of node.getAttributeNames()) if (name.startsWith('data-') || name === 'role') attrs.push(`${name}=""`);
  const inner = [...node.children].map(child => shape(child, depth + 1)).join('');
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  return tag === 'img' ? open : `${open}${inner}</${tag}>`;
})($0));
```

## pixiv投稿後のメタデータ残存の実測（Issue #12）

pixivへの投稿・変換後に生成情報が残るかを、**自分が権利を持つ画像だけ**で確認します。原本・投稿画像・Prompt・Cookieはリポジトリへ入れず、集計表だけを記録します。特定の画像についての「AI製／人間製」の判断には使いません。

1. 形式ごとに検証用画像を用意します（NovelAI形式のPNGテキスト、NovelAI Stealth、ComfyUI PNG、A1111/Forge PNG、JPEG/WebPのEXIFなど、用意できる範囲）。各ファイルの`sha256sum`、寸法、拡張の**ローカル検査ページ**での結果（形式・生成元の推定・Stealth・EXIF）を記録します。
2. 正規の手段でpixivに投稿します（公開範囲は自分で判断）。
3. 投稿後、拡張のホバーから**Metadata**で原寸を検査し、結果とHTTP状態を記録します。あわせて、pixivの画像ビューアで原寸を開いてブラウザで保存し、ハッシュ・寸法を記録して、ローカル検査ページでも確認します。
4. 表示用縮小画像（ホバーで表示される画像）は、ブラウザで保存したものを同様に確認します（ある場合）。
5. 取得できなかったもの（403・404・429など）は「メタデータなし」と分け、「検査不能」として数えます。

| 形式 | サンプル数 | 生成直後: 情報あり | 投稿後の原寸: 情報あり / なし / 検査不能 | 原寸のハッシュ一致 | 縮小画像: 情報あり / なし / 検査不能 | 備考 |
|---|---|---|---|---|---|---|
| NovelAI PNGテキスト | | | | | | |
| NovelAI Stealth | | | | | | |
| ComfyUI PNG | | | | | | |
| A1111/Forge PNG | | | | | | |
| JPEG/WebP EXIF | | | | | | |

サンプル数と選定条件を併記し、少数の結果を一般化しすぎないでください。

## 403の切り分け

| 層 | 取得元 | 2026-11-19の実測 | 失敗時の扱い |
|---|---|---|---|
| document | 通常のpixivページ | 自動ブラウザ: 403（Cloudflare確認画面） / 通常のHTTP: 200 | 確認画面なら自動試験を止め、手動で確認する |
| pages API | `/ajax/illust/{id}/pages`（同一オリジンの通常セッション） | 200（公開作品・ログアウト） | 401/403/404/429とpixivのメッセージを表示。サムネイルとローカル読込は残す |
| original | API由来のURL、拡張Worker、Cookieなし・`Referer: https://www.pixiv.net/`（セッションルール） | Refererなし: 403（11-19） / あり: 200（11-22、Workerから） | 失敗時は層・理由を表示し、ローカル読込を案内。再試行しない |
| 表示用画像 | ページ上の`<img>`（ブラウザ既定のReferer） | 自動では未確認 | 表示できない場合は作品ページへの案内 |

拡張の画像表示、ブラウザで原寸を開く操作、拡張がバイト列を読む処理は、成功条件が異なります。差があっても、根拠なしに原因を断定しないでください。拡張自身の原寸取得へのReferer付与以外に、ヘッダーの変更・CORSの書き換え・認証の移植・外部proxy・自動再試行は行いません。

## コマンド（接続確認のみ）

```bash
# documentへの接続だけを確認します。確認画面・拒否のときは何もせずに終了します（exit 1）。
npm run verify:live -- --url https://www.pixiv.net/ --output .verification/connectivity.json

# ユーザーが用意した作品の0始まりのページを1枚だけ、従来パネルで検査します。
npm run verify:live -- --url https://www.pixiv.net/artworks/ARTWORK_ID --page 0
```

新しい使い捨てプロファイルを使います。`--headed`、`--local-file ./your-original.png`、`--browser msedge`（Edgeがある環境）も指定できます。保存するのは日時・ブラウザ版・git revision・生成物ハッシュ・status/MIME・原寸の件数・分類だけで、画像・Prompt・URL・HAR・認証情報は保存しません。

## 記録テンプレート

```text
日時 (JST) / OS / ブラウザと版:
拡張のrevision / 生成物ハッシュ:
ページ種別 / ログイン状態 / 正規に閲覧できる範囲:
Document: PASS / FAIL / NOT RUN (HTTP / MIME)
一覧での検出（ページ種別ごと）/ 検出されない構造:
プレビュー表示 / ページ順 / wheel / Metadata前の原寸要求数:
Pages API: PASS / FAIL / NOT RUN (HTTP / MIME / ページ数)
Original: PASS / FAIL / NOT RUN (HTTP / MIME / 拡張からの件数)
ローカルファイル: 独立readerとの一致 / Stealth / EXIF / 署名の表示:
取消 / キャッシュ / SPA / 2タブ / クリップボード / Escape:
Chrome / Edge / 120:
判定: GO / NO-GO（理由）:
```
