# Gate 0 / Gate 1 実機確認手順

更新: 2026-10-23。実ChromeのMV3経路は合成応答でPASS。実pixivはトップページHTTP 403で停止し、作品・API・原寸の受入はNOT RUNです。[証跡](evidence/README.md)を参照。

## ビルドと実MV3の回帰確認

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:edge
PAMI_CHROME_PATH=/path/to/chrome-for-testing/chrome npm run test:extension
```

`test:extension`は新しい一時プロファイルに本番ビルドを読み込み、終了時に削除します。既存プロファイルは使いません。すべての通信は合成応答へ差し替え、閉じたShadow DOMをDevToolsで操作します。ソースのShadow DOMやruntime APIはテスト用に変更しません。

## 実pixivの再現用コマンド

正規に閲覧できる、自分が権利を持つテスト作品を用意してください。画像を投稿する場合は自分でpixiv上の通常手順を使い、検証のためにアクセス制限を緩めたり認証を回避したりしません。

```bash
# pageは0始まり。選択したページ1枚だけInspectする。
PAMI_CHROME_PATH=/path/to/chrome-for-testing/chrome npm run verify:live -- \
  --url https://www.pixiv.net/artworks/ARTWORK_ID --page 0 \
  --output .verification/single.json

# 正規保存したローカル元画像によるfallbackを同じ画面で確認する。
PAMI_CHROME_PATH=/path/to/chrome-for-testing/chrome npm run verify:live -- \
  --url https://www.pixiv.net/artworks/ARTWORK_ID --page 0 \
  --local-file /path/to/your-original.png --output .verification/fallback.json

# 接続だけを確認する場合。作品/API/原寸は操作しない。
PAMI_CHROME_PATH=/path/to/chrome-for-testing/chrome npm run verify:live -- \
  --url https://www.pixiv.net/ --output .verification/connectivity.json
```

Node 22.14以降を使用。TypeScriptをネイティブstripする実験機能の警告は開発用コマンドに限られます。拡張のコードをこの方法で配布するわけではありません。

このコマンドは毎回新しいプロファイルで**ログアウト状態**を調べます。Cookie/トークン/既存セッションを読み出しません。`--headed`で表示可能。実Edgeが利用できる場合は`--browser msedge`がありますが、Edgeのsideload用起動フラグの対応は環境依存です。読み込みに失敗した場合はFAILとなるため、下記のGUI手順を使用してください。

記録するのは日時、ブラウザ版、基準コミット、作業ツリー変更有無、生成物ハッシュ、HTTP状態・MIME、原寸リクエスト数、制御された結果分類です。画像・Prompt・RAW・認証情報・作品URLをJSONへ保存せず、スクリーンショットやHARも取得しません。取得失敗時は非zero終了。documentが403ならそれ以上進まず、再試行はしません。

`formatAndResult: PASS`は結果分類が表示されたことを示します。実際の生成元やPromptの正しさを外部検証した意味にはならないため、以下の独立照合も行ってください。

## GUIでの署名なし通常メタ・認証・Edge確認

1. Chrome/Edgeの**開発用プロファイル**で拡張管理を開き、`.output/chrome-mv3/`または`.output/edge-mv3/`を読み込む。普段のプロファイルのCookie等をコピーしない。
2. 必要ならユーザー自身が通常のログイン画面からログインする。エージェントへ認証情報を渡さない。
3. 作品ページを開き、`AI Metadata`が1つだけ表示されることを確認。pixiv自身の画像通信と拡張の通信を区別する。
4. パネルを開き、作品APIのHTTP状態・Content-Type・候補数だけ記録。single/multiのp0..pNが一致することを確認。
5. 1枚を選びInspect。Service WorkerのNetworkで、その1枚だけの原寸取得、HTTP状態、MIME、表示形式を確認。401/403/429なら自動再試行やヘッダー変更をしない。
6. 取得できなければ、pixivで正規保存できる元画像を明示選択。手動読込成功をpximg取得成功と記録しない。
7. 結果を元のローカル生成設定・独立readerと比較。クラウドへの画像アップロードは本拡張の検証に含めない。NovelAIは公式ローカルスクリプト、ComfyUIは生成時のworkflow/SaveImage出力を使う。

自作fixtureは`tests/reference/fixtures/`にあります。これらは公式reader/writerで照合した人工1×1画像であり、NovelAIの実生成・署名正例ではありません。正規の作品への投稿はユーザー自身の判断と通常操作で行ってください。

## 必要な証跡と受入マトリクス

| 対象 | 保存する証跡 | 実pixivの状態 |
|---|---|---|
| 単一画像 / 複数画像 | 候補数、選択ページ、原寸のstatus/MIME、並び順 | NOT RUN |
| NovelAI PNG | 通常テキストの共通Prompt/Negative/Seed等と独立readerの一致。署名状態を別記 | NOT RUN |
| ComfyUI PNG | prompt/workflow JSONの完全保持、生成時グラフとの一致 | NOT RUN |
| JPEG / メタなしPNG | 形式と未対応/メタなしを区別。取得不能と混同しない | NOT RUN |
| SPA / タブ切替 / 連続操作 | 古い候補・結果破棄、取得は全タブ合計1、明示操作のみ | NOT RUN |
| 取消 / timeout / 通信失敗 | 操作、結果、復旧後の明示Inspect、取得件数 | NOT RUN |
| 403 / ログアウト / 正規の制限作品 | statusとfallback。アクセス制限を回避しない | NOT RUN |
| ライト/ダーク / 360px / keyboard / コピー | 画面・フォーカス・クリップボード許可/拒否の結果 | NOT RUN |
| Chrome / Edge / 最低120 | 完全なブラウザバージョンと各結果 | NOT RUN |

異常・巨大ファイル・429・意図的timeoutは`test:extension`などの合成試験で確認します。実pixivへ負荷をかけてエラーを誘発しません。自然に403/429になったときだけ実サイトの結果を記録します。

```text
日時 (JST):
OS / browser version:
Extension version / git revision / artifact hashes:
Artwork type: single / multi(count) / NovelAI PNG / ComfyUI PNG / JPEG / no-metadata
Injection: PASS / FAIL / NOT RUN
Pages API: HTTP / MIME / candidate count
Original fetch: HTTP / MIME / format / extension-origin request count
Extraction match: PASS / FAIL / NOT RUN (independent reader and field names only)
Local fallback: PASS / FAIL / NOT RUN
SPA / cancellation / concurrency / clipboard:
Gate 1 release: GO / NO-GO / NOT RUN (reason)
```

生の画像、プロンプト、URL、Cookie、認証画面をリポジトリへ保存しないでください。現時点の本リポジトリのリリース判定はNO-GOです。実サイトと実Edgeの未確認が解消してからGate 2実装に進みます。
