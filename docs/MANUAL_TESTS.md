# 実機確認手順

更新: 2026-11-15。合成ページの成功と実pixivでの成功を分ける。[現状](TEST_STATUS.md)。この環境の通常接続はトップページ403で、実作品受入はNOT RUN。

## 自動回帰

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:edge
npm run test:browser
npm run test:extension
```

必要なら`PAMI_CHROME_PATH=/path/to/chrome`を指定する。LinuxはPlaywrightの共有ライブラリも必要。`test:extension`は一時プロファイルに本番ビルドを読み込み、全通信を合成応答へ差し替える。既存プロファイル・認証情報は使わず、終了時にプロファイルを削除する。closed Shadow DOMへのアクセスはDevToolsだけで行い、製品にテスト用の橋は追加しない。

## GUIでの実pixiv確認

1. ユーザー自身が開発用Chrome / Edgeプロファイルへ[README](../README.md)の手順で拡張を読み込む。必要なら通常のログイン画面でログインする。Cookieやトークンはコピーしない。
2. 正規に閲覧できる自作・権利処理済みの単一/複数枚作品を準備する。作品を投稿したり公開範囲を変更する操作はユーザーが判断する。
3. 検索・ランキング・投稿一覧・ブックマーク・フォロー新着・作品ページの関連作品で、それぞれサムネイルにホバーする。250ms未満では何も取得せず、長いホバーでは対象作品のAPIだけが呼ばれるか確認する。
4. プレビューにマウスを移動し、画像の縦横比、タイトル/作者（取得できる場合）、ページ数、作品リンクを確認する。サムネイルをクリックしたときの通常遷移も維持されること。
5. 複数枚でホイールの上下・連続trackpad・ボタン・左右キーを試す。ページと画像が一致し、先頭/末尾で停止し、原寸画像を取得しないこと。単一画像では切替ボタンが隠れ、通常スクロールを妨げないこと。
6. Metadataを押し、そのページの原寸1件だけがWorkerから取得されることを確認する。切替時に古い結果が消え、戻るとキャッシュ済みの対応結果だけが表示されること。取消も試す。
7. Prompt/Negativeの改行、設定、折り畳みのComfyUI/RAWとコピーを、自作元ファイル・独立したローカルreaderの結果と比べる。署名文字列だけで検証成功と表示しないこと。
8. 画面四隅・スクロール・resize・狭幅・高DPI・ライト/ダーク・Tab・下矢印でのプレビュー内移動・Escapeを試す。両方から離れると200ms後に閉じ、Escape後に元リンクへフォーカスが戻ること。
9. 高速ホバー・SPAのURL変更・カード再利用・遅延追加・戻る/進む・BFCache・2タブ・長時間表示を試す。古い画像/結果を混入せず、全タブの原寸同時取得は1件、メモリキャッシュは失効/破棄されること。
10. 作品ページの従来AI Metadataパネル、ローカルファイル、未対応JPEG/WebPの表示も確認する。

実サイトへ負荷をかけて429やtimeoutを誘発しない。これらは合成試験で行う。第三者の画像・Prompt・認証情報をリポジトリや証跡へ保存しない。

## 403を切り分ける

DevToolsで次の3層のstatus/MIME/件数だけを記録する。

| 層 | 取得元 | 失敗時の扱い |
|---|---|---|
| document | 通常のpixivページ | 403なら停止。API/原寸を成功/失敗と推測しない |
| pages API | `/ajax/illust/{id}/pages`、同一オリジン通常セッション | 401/403/429、JSON/候補順を確認。見えているサムネイルとローカル読込は残す |
| original | API由来の正確なURL、拡張Worker | 401/403/429/timeoutを別記。表示可能な縮小画像は継続する |

原寸URLと作品ID/ページの一致をローカルで確認し、ユーザーの通常ブラウザ操作で同じ画像を開けるかも別に記録する。ページの画像表示、通常ブラウザで原寸を開く操作、拡張がバイト列を読む処理は同じ成功条件ではない。

Workerは`credentials: omit`、`referrerPolicy: no-referrer`、リダイレクト拒否。ページの画像表示はブラウザの通常ポリシーに従う。差があっても、それだけでCookie/Referer/CORSが403の原因と断定しない。ログイン状態、公開範囲、通常閲覧権限、ブラウザ版を分けて記録する。ヘッダー偽装・認証移植・外部proxy・自動再試行は行わない。

原寸を正規保存できる場合のみ明示ファイル選択を試す。ローカル成功をpximg成功と数えない。ローカル結果は表示作品と同一である保証がないことを確認する。

## 通常接続の再現コマンド

```bash
# 接続だけ。document拒否時は停止する。
npm run verify:live -- --url https://www.pixiv.net/ --output .verification/connectivity.json

# ユーザーが用意した作品の0始まりpageを1枚だけ検査する。
npm run verify:live -- --url https://www.pixiv.net/artworks/ARTWORK_ID --page 0
```

新規・ログアウトプロファイルを使う。`--headed`、`--local-file /path/to/your-original.png`、`--browser msedge`も指定できる（Edgeが実際に利用できる環境のみ）。コマンドは従来の作品ページパネルを操作する。ライブ一覧hoverはGUI手順で確認する。

保存するのは日時、ブラウザ版、git revision、生成物ハッシュ、status/MIME、原寸件数、分類状態だけ。原寸取得前のdocument拒否は非zero終了となる。画像やPrompt、URL、HAR、認証情報は保存しない。

## 記録テンプレート

```text
日時 (JST) / OS / browser version:
Extension revision / artifact hashes:
Page type / signed-in state / legitimately accessible scope:
Document: PASS / FAIL / NOT RUN (HTTP / MIME)
Hover / enter-leave / focus / Escape / viewport / light-dark:
Pages API: PASS / FAIL / NOT RUN (HTTP / MIME / candidate count)
Preview display / page order / wheel / original request count before Metadata:
Original: PASS / FAIL / NOT RUN (HTTP / MIME / extension-origin count)
Normal browser original display: PASS / FAIL / NOT RUN
Extraction match / no-metadata / unsupported / signature claim:
Local fallback / cancellation / cache / SPA / multiple tabs / clipboard:
Chrome / Edge / minimum version 120:
Release: GO / NO-GO (reason):
```

Stealth・キャラクターcaption・暗号学的署名・JPEG/WebP EXIFの検査は未実装として記録する。
