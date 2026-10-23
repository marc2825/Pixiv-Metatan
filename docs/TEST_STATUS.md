# Verification status — 2026-10-23 (JST)

## Gate判定

| Gate | 判定 | 根拠 |
|---|---|---|
| Gate 0 開発環境 | GO | 型チェック・単体/結合テスト・Chrome/Edgeビルド |
| Gate 0 実pixiv | NO-GO | 通常のトップページ接続がHTTP 403。作品/API/原寸はNOT RUN |
| Gate 1 合成ページでの実MV3 | GO | 本番ビルドを一時Chromeプロファイルに読み込み、実際のcontent script/worker通信で9件PASS |
| Gate 1 リリース | NO-GO | 実作品、ログイン状態、実Edgeの受入未完了 |
| Gate 2 | 未着手 | Gate 1実サイト受入待ち。公式処理とのローカル照合を追加 |

## 最終結果

| 検証 | 結果 | 証拠・範囲 |
|---|---|---|
| `npm run typecheck` | PASS | WXT prepare + TypeScript strict |
| `npm test` | PASS | 6 files / 141 tests |
| `npm run build` | PASS | Chrome MV3、約39.80 kB |
| `npm run build:edge` | PASS | Edge MV3、約39.80 kB。実Edge起動の証拠ではない |
| `npm run test:browser` | PASS | 既存アダプタによる合成Chrome試験6件 |
| `npm run test:extension` | PASS | 実MV3拡張 + 合成応答9件、Chrome for Testing 155.0.8059.84 |
| 公式ローカル処理との照合 | PASS | 人工fixture6件。NovelAI通常PNG reader、ComfyUI SaveImageクラス、偽署名の拒否 |
| 実pixivトップページ | FAIL | HTTP 403、HTML。認証なし・応答差替えなし・ヘッダー偽装なし。原因は特定していない |
| 実作品のsingle/multi/NovelAI/ComfyUI/JPEG/メタなし | NOT RUN | サイト接続の拒否と、正規のテスト作品URL未提供。推測URLへ取得しない |
| 実pixiv API・原寸HTTP / 実作品でのfallback | NOT RUN | トップページ403で停止。原寸リクエスト0 |
| 実pixivでのSPA・タブ・取消・通信異常 | NOT RUN | 合成MV3試験での結果と区別 |
| 正規ログイン/年齢制限作品、実Edge、最小120 | NOT RUN | 既存プロファイル・認証情報の移植なし。Edge実行ファイルなし |
| NovelAI cloud Inspect・ComfyUIサーバーとの比較 | NOT RUN | 画像アップロード、モデル生成、サーバー起動は未実施 |
| Stealth / キャラクター別 / JPEG-WebP EXIF / 正当な署名 | NOT RUN | 未実装。本拡張はverified/invalidを生成しない |
| `git diff --check` / 生成manifest | PASS | 権限追加なし。pixiv/pximgのみ |

未解消の自動テストFAILはありません。実サイトの403は未解決の接続結果であり、受入PASSには数えていません。

## 証跡

- [live-connectivity-2026-10-23.json](evidence/live-connectivity-2026-10-23.json): 実ブラウザ・通常HTTPSの403。日時、ブラウザ、基準コミット、作業ツリー変更有無、検査ビルドのSHA-256、リクエスト数を記録。
- [mv3-synthetic-2026-10-23.json](evidence/mv3-synthetic-2026-10-23.json): 各試験の結果、実ブラウザ版、ビルドSHA-256、合成HTTP状態とworker起点かどうか。
- [公式照合fixtureの根拠](../tests/reference/README.md)、[独立した期待値](../tests/reference/fixtures/expected.json)。

証跡には画像本体、第三者のPrompt、Cookie、トークン、実作品URLを含めません。HEADは`b31a0b9`、今回の修正は作業ツリー上のため、検査対象はコミット番号だけでなく生成物ハッシュで区別します。

## 今回の不具合と修正

公式`nai_sig.Metadata.decoded_comment`が扱う1段の`Comment` envelopeについて、旧実装は内側のPrompt/Negative/Seedを抽出しませんでした。公式readerで読み取った人工PNGを入力してFAILを再現し、1段だけ安全にJSON展開する修正を加えました。RAWを保存し、壊れた内側JSON、非object、深いwrapper、偽署名もテストしました。

テスト基盤ではNodeのJSON import属性と、結果未生成中のポーリングを修正しました。ファイル選択はDevToolsから本物のボタンをクリックし、本番の閉じたShadow DOMとisolated content scriptを変更しません。

## 実MV3試験で新たに確認したこと

1. 本番content scriptの注入、closed root、Inspect前の原寸取得なし、ページ選択とruntime.sendMessage。
2. NovelAI/ComfyUI/A1111・メタなし・JPEGの区別。独立fixtureのRAW/正規化値も実worker経由で確認。
3. 画像403とAPI429を別の経路で発生させ、明示ファイル選択のfallbackを確認。自動再試行なし。
4. 2タブを同じworkerへ接続し、単一の取得枠、busy、所有者側の選択変更による取消、次の選択の成功。
5. 実際のhistory.pushStateとタブURL確認、古い候補・結果の破棄。
6. worker fetchの通信中断、後続の明示Inspectによる復旧。
7. テスト用に時間を短縮せず、本番15秒でタイムアウトとUI復旧。

HTTP応答を合成した試験では、実pximgの成功やアクセス制御の妥当性を主張しません。Chromeのホスト権限・content script隔離・拡張メッセージを使う経路は通しましたが、Edge・MV3の長時間寿命・実pixivのDOM/CSPは別項目です。

## 実行環境と再現

Linux x64、Node 22.14.0、npm 10.9.2、TypeScript 5.9.3、WXT 0.21.4、Vitest 5.0.5、Vite 8.3.5、Playwright 1.64.1。

Node/npmは`/tmp/pami-tools/node-v22.14.0-linux-x64/bin`、Chrome for Testingは`/tmp/cp-tree-tools/chrome-linux64/chrome`を使用。Chrome起動には実行環境のソケット制限外での実行が必要でした。通常の開発環境ではPATHと`PAMI_CHROME_PATH`を適宜設定してください。

ローカル公式照合は一時Python環境のPillow/NumPy/PyNaClを使用。外部のソースやPython依存を拡張へ追加していません。標準の`npm test`はコミットした人工fixtureだけで動き、Python・ネットワークを必要としません。

2026-10-22の初回検証は129 tests / アダプタ6件PASS。その後`b31a0b9`としてコミット。今回のPhase A/Bはその後続で、[手動検証手順](MANUAL_TESTS.md)と`npm run verify:live`を追加しています。実サイト403を回避する実装や公開操作は行っていません。
