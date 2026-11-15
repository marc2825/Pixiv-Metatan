# Verification status — 2026-11-15 (JST)

**実装・合成試験: GO。実pixiv受入・リリース: NO-GO。** 通常接続のdocumentが403で、実作品のAPI・画像・DOMは未検証。原寸403の原因は特定していない。

## 最終結果

| 検証 | 結果 | 範囲 |
|---|---|---|
| `npm run typecheck` | PASS | WXT prepare + TypeScript strict |
| `npm test` | PASS | 8 files / 191 tests。既存141件を維持 |
| `npm run build` | PASS | Chrome MV3、約57.69 kB |
| `npm run build:edge` | PASS | Edge MV3、約57.69 kB。実Edge起動とは別 |
| `npm run test:browser` | PASS | 12件。テスト用アダプタ・合成ページ/HTTP |
| `npm run test:extension` | PASS（17件） | 本番MV3・closed root・runtime/Worker。合成HTTPのみ |
| 独立したreader/writer fixture | PASS | 既存の人工6件を単体・本番Worker経由で維持。実生成・正当な署名の証明ではない |
| `git diff --check` / 生成manifest | PASS | API権限なし、pixiv/pximgホストのみ。依存追加なし |
| 実pixivトップページ | FAIL | Chrome 156.0.8078.4、通常HTTPS、document HTTP 403 / text/html |
| 実pixiv一覧DOM・ホバー・複数枚 | NOT RUN | document拒否。正規のテスト作品URLも未指定 |
| 実作品API・原寸URL・CDN取得 | NOT RUN | document拒否で停止。原寸リクエスト0 |
| 通常操作で原寸を開く / Workerとの比較 | NOT RUN | 作品API・原寸URL未取得 |
| ログイン/公開範囲/年齢制限の正規閲覧 | NOT RUN | 認証移植なし。新規ログアウトプロファイル |
| 実Edge / 最低Chrome・Edge 120 / 高DPI / 長時間寿命 | NOT RUN | Edgeビルドと実Edge動作を区別 |
| Stealth / V4-V5キャラクターPrompt / EXIF / 署名検証 | 未実装 | 今回の範囲外。verified/invalidを生成しない |

## 自動試験で確認したこと

- 従来の通常PNG、CRC/構造/圧縮/サイズ/JSON上限、NovelAI/ComfyUI/A1111、未対応・メタなし、安全なテキスト表示、署名の自己申告を維持。
- 遅延追加のサムネイル、250ms遅延・通過時の取消、プレビューへの移動・離脱猶予、高速ホバーの遅いAPI応答、単一/複数枚、ページ境界と番号。
- 小さなwheelデルタの蓄積、連続trackpadの1ジェスチャ、クールダウン、ボタン/左右キー、単一画像と通常リンク操作の維持。
- 狭幅ライト/ダークで画面端の配置、キーボードでの進入・Tab・Escape・フォーカス復帰、Prompt内キー操作、ページスクロールの抑制範囲。
- API/原寸の401/403/429、API timeoutの分類、原寸本番15秒timeout、通信エラー、表示用画像の継続とローカル読込。
- ページ別キャッシュ再利用、件数/容量/LRU/TTL、従来/hover間の一覧・429待機の共有、API直列化・中止済み待機の除外、429 cooldown、古い解析結果の取消、SPA/BFCache/破棄。
- 自拡張ID・frame・tab・pixiv origin・操作時の完全な現在URL、取得後の再照合、作品/ページ/URL不一致、不正メッセージの拒否。page postMessageからの要求は受け付けない。
- 実MV3合成試験で検索/ランキング/投稿/ブックマーク/フォロー新着からの解析、Worker起点の原寸1件、2タブの単一枠・取消、ローカル結果の分離。

新UIで結果領域が増えたため、既存ブラウザ試験のlocatorsを完全一致にした。API直列化に合わせ、既存DOM試験では通信開始を待ってから遷移/破棄し、従来の取消保証を維持した。検証項目や期待値は削除していない。閉じたShadow DOMではdocument側のcomposedPathから内部ノードが見えないため、結果内キー操作の除外にはshadow.activeElementを使い、回帰試験を追加した。

## 実サイトの403と証跡

[2026-11-15通常接続](evidence/live-connectivity-2026-11-15.json)は無認証の一時Chromeプロファイルで、応答差替え・ヘッダー偽装・proxyなし。documentで停止し、API/原寸の再試行はしていない。これは依頼にある原寸`http-403`そのものの再現ではない。API成功・原寸URLの妥当性・画像配信側のアクセス条件・Referer/Cookie/CORSの因果関係は確認できていない。

[本番MV3の合成証跡](evidence/mv3-synthetic-2026-11-15.json)にはstatus/MIME、件数、Worker起点か、生成物SHA-256を保存する。画像・Prompt・RAW・Cookie・トークン・実作品URL・HARは含めない。ライブ証跡は接続確認時の中間ビルドのハッシュであり、最終合成試験のビルドと区別する。

過去の2026-10-23証跡は履歴として残している。現状の判定はこの文書と2026-11-15の証跡を参照。

## 実行環境・制約

Linux x64、Node 24.21.0、npm 11.19.0、Chrome for Testing 156.0.8078.4、Playwright 1.64.1。初回のブラウザ試験は共有ライブラリ不足で起動できなかったが、一時領域の既存ライブラリを指定して再実行した。リポジトリやOSに依存を追加していない。環境指定:

```bash
LD_LIBRARY_PATH=/tmp/portfolio-ci-libs/root/usr/lib/x86_64-linux-gnu \
PAMI_CHROME_PATH=/home/marc2825/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
npm run test:browser
# 同じ指定で npm run test:extension / npm run verify:live
```

ブラウザ起動・通常接続はsandbox外で実行した。一時プロファイルは試験後に削除し、既存ユーザープロファイルは操作していない。次は[実機確認](MANUAL_TESTS.md)で正規に閲覧できるテスト作品のDOM・API/CDN・Chrome/Edgeを確認する。
