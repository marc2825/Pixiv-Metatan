# Gate 0 / Gate 1 実機確認手順

状態: **NOT RUN**（2026-10-22）。本作業ではユーザーのブラウザプロファイルへの拡張インストールや、実pixivの作品アクセスを実施していません。

## 準備

1. `npm ci && npm run typecheck && npm test && npm run build && npm run build:edge`。
2. ユーザー自身がChrome/Edgeの拡張管理で対応する出力を読み込む。
3. 自分が権利を持つ人工PNGを投稿した単一画像と複数画像の作品を使用。第三者作品、R18画像、プロンプト、Cookie等をリポジトリへ保存しない。
4. ブラウザの完全なバージョン、拡張バージョン、OSを記録。作品URLは公開報告ではIDを伏せ、single/multi/authorized-adult等の種類だけを残す。

## 技術的実現可能性を先に確認

1. 作品ページを開き、`AI Metadata`が1つだけ表示されること。まだAPI/原寸の検査要求を送っていないことを拡張のNetworkとpixiv側のNetworkで区別して確認する。pixiv自身の画像通信は拡張の通信として数えない。
2. ボタンを押す。`/ajax/illust/{id}/pages`のステータス・Content-Type・候補数だけを記録。返されたoriginal URLが作品ID・p0..pNの順序と一致することを確認。
3. 選択した1枚をInspect。拡張Service WorkerのNetworkで、そのURL1つだけを取得し、リダイレクトなし・認証情報なし・Referer偽装なしであることを確認。
4. **200**なら、そのデータの形式と結果を記録。**401/403/429**なら理由とローカル読込案内を確認し、手動で正規保存した同じ元画像を選択する。ヘッダー変更や外部プロキシを試さない。
5. 手動読込が成功しても「pximgの取得がPASS」としない。HTTPステータスとfallbackの結果を別欄に記録。

## 回帰・受入

| 項目 | 操作 / 期待結果 | 初期状態 |
|---|---|---|
| 注入 | single / multi両方で1つのボタン | NOT RUN |
| 順序 | 1枚/10枚でp0/p9選択、表示とURLが一致 | NOT RUN |
| 明示操作 | 表示・ページ選択だけでは原寸検査の通信なし | NOT RUN |
| 連打 / タブ | 連打・2タブのInspectで同時取得1件 | NOT RUN |
| 取消 | 途中で取消・選択変更・閉じる・タブ終了。追加取得なし | NOT RUN |
| SPA | 検査途中に別作品/作者画面へ。古い結果を表示しない | NOT RUN |
| 認証 | ログアウト時、拒否を案内し手動読込を利用可能 | NOT RUN |
| 年齢制限 | 既に正規閲覧できる場合のみ。認証や年齢制限を回避しない | NOT RUN |
| レート制限 | 自然に429になった場合だけ確認。故意の大量要求は禁止 | NOT RUN |
| UI | ライト/ダーク、キーボード、Escape、360px幅、コピー許可/拒否 | NOT RUN |
| ブラウザ | ChromeとEdgeそれぞれで上記を確認 | NOT RUN |

異常応答・巨大ファイルの試験はローカル合成テストを使用してください。実pixivへ負荷をかけてエラーを誘発しません。

## 記録テンプレート

```text
日時 (JST):
OS / browser version:
Extension version / git revision:
Artwork type: single / multi (count) / authorized-adult / logged-out
Injection: PASS / FAIL / NOT RUN
Pages API: HTTP / Content-Type / candidate count / sanitized cause
Original fetch: HTTP / Content-Type / result (PASS / FAIL / NOT RUN)
Local original fallback: PASS / FAIL / NOT RUN
SPA / cancellation / concurrency / clipboard:
Gate 0: GO / NO-GO / NOT RUN (reason)
Gate 1 release: GO / NO-GO / NOT RUN (reason)
```

Gate 0で直接取得が拒否されても、正規の手動読込が成功するなら「直接取得制限あり・fallback動作確認」として評価します。アクセス回避をGOの条件にしません。実機項目に未確認が残るうちは、Gate 1全体や一般公開をGOとしません。
