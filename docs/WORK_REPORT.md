# 作業報告 — 初回2026-10-22 / 更新2026-10-23

初回Gate 1実装は`b31a0b9`でコミット済みです。今回、実MV3と合成応答9件を検証し、公式の通常PNG readerとの照合でComment envelopeを修正しました。実pixivはdocument 403で、作品・原寸は未検証、リリースはNO-GOです。後半の「2026-10-23: Phase A/B」が最新の報告です。Gate 2機能と正当な署名の検証は未実装です。

## 実装済み

- PNG tEXt/zTXt/iTXt、CRCと構造検証、上限付き展開、文字コード、重複RAW保持。
- NovelAI通常メタ、ComfyUIノード/ワークフローのRAW表示、A1111/Forge設定分離、混在根拠と未検証署名状態。
- クリックで選択した原寸1枚、現在作品・ページ・送信元の検証、ストリーム48 MiB、MIME/magic照合、タイムアウト・取消・並列数1。
- ローカルfallback、SPA/BFCache、検査済みマーカー、RAW、コピー、フォーカス・Escape、ダーク/狭幅。
- Chrome/Edgeビルド、lockfile、クリーン環境のWXT準備、129件の単体/結合テストと6件の合成Chrome試験。

## 変更したファイル

| 区分 | ファイル |
|---|---|
| MV3入口 | `entrypoints/background.ts`, `entrypoints/pixiv.content.ts` |
| 解析 | `src/limits.ts`, `src/metadata/png.ts`, `src/metadata/inspect.ts`, `src/metadata/normalize.ts`, `src/metadata/types.ts` |
| 通信・pixiv | `src/network/inspector.ts`, `src/pixiv/artworks.ts` |
| 表示 | `src/ui/app.ts`, `src/ui/result.ts` |
| 単体・結合 | `tests/fixtures.ts`, `tests/parser.test.ts`, `tests/pixiv.test.ts`, `tests/network.test.ts`, `tests/ui.test.ts`, `tests/entrypoints.test.ts` |
| ブラウザ試験 | `tests/browser/harness.ts`, `tests/browser/inspector.spec.ts`, `tests/browser/vite.config.ts`, `playwright.config.ts` |
| 設定 | `package.json`, `package-lock.json`, `wxt.config.ts`, `vitest.config.ts`, `.gitignore` |
| 文書 | `AGENTS.md`（現状の制限のみ更新）, `README.md`, `SECURITY.md`, `docs/REQUIREMENTS.md`（状態のみ更新）, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/TEST_STATUS.md`, `docs/RELEASE_CHECKLIST.md`, `docs/MANUAL_TESTS.md`, `docs/NOVELAI_RESEARCH.md`, `docs/PRIVACY.md`, `docs/WORK_REPORT.md`, `docs/screenshots/README.md`, `docs/screenshots/synthetic-dark-mobile.png` |

`docs/CODEX_FIRST_PROMPT.md`と既存LICENSEは変更していません。生成ビルド、node_modules、テストレポートはgitignore対象です。

## 未実装と技術的リスク

- Stealth PNG、V4/V5キャラクターPrompt分離、JPEG/WebP EXIF、暗号学的署名検証。公式同一画像クロスチェックも未実施。すべてGate 2。
- 未文書化pixiv APIとURL形状への依存。厳格な検証に合わないURLは推測せずfallbackにする。
- pximgが拡張からの取得を拒否する可能性。host permissionは200を保証せず、401/403/429を回避しない。
- 合成試験ではMV3寿命、実host permission、pixiv DOM/CSP、ログイン状態、Edge実機を再現していない。
- PNG画素を展開せず、画像としての完全な妥当性やStealthの有無は判断しない。署名・モデル情報は自己申告。
- 全依存関係の脆弱性/ライセンス監査・公開ポリシー確認・公開素材はGate 3。

## テスト・次の作業

最終結果は[TEST_STATUS.md](TEST_STATUS.md)にPASS/FAIL/NOT RUNを区別して記録。

次はユーザーが正規閲覧できる自作・権利処理済み作品を用い、[MANUAL_TESTS.md](MANUAL_TESTS.md)でChrome/Edgeの注入、1/複数枚、API応答、原寸HTTPステータスとfallbackを記録します。Gate 1実機受入がGOになったら、[NOVELAI_RESEARCH.md](NOVELAI_RESEARCH.md)に沿ってGate 2を実装し、公式Python検証と照合します。

開始時のgit statusはclean。変更はすべて未コミットの作業ツリーに残しました。push・PR・一般公開・ユーザーのブラウザへの拡張インストールは行っていません。

## 2026-10-23: Phase A/B — 実機経路と公式処理の照合

初回作業は`b31a0b9`としてコミット済み。本節は、その後の作業ツリー上の変更です。

**結果: 実MV3の合成試験はGO、実pixiv受入とリリースはNO-GO。** 開発用の一時Chrome for Testing 155.0.8059.84へ本番ビルドを読み込みました。実pixivトップページは通常HTTPSで403となり、API・原寸・実作品の検査は進めていません。原因をログインやhotlink規制と断定していません。応答差替え・認証移植・ヘッダー変更・proxy・再試行ループはありません。

- `test:extension`を追加。実content script、closed root、runtime.sendMessage、worker fetch、tabs.getを使用。合成HTTPで、単一画像、各形式、独立fixture、403/429 fallback、2タブ単一枠、取消、SPA、通信中断、本番15秒timeoutを9件確認。
- `verify:live`を追加。対象の作品URLとページを指定して1回だけInspectする再現用コマンド。状態・MIME・形式分類・リクエスト数・生成物ハッシュを記録し、画像やPrompt、RAW、URL、認証情報を保存しない。
- 独立した人工fixture6件を追加。NovelAI公式の通常PNG reader、ComfyUI公式SaveImageクラスとローカル照合。モデル/サーバー/cloud Inspectは利用せず、正当なNovelAI署名の正例は未確認。
- 品質不具合を1件修正。Comment内の1段のComment JSONを旧実装が抽出できなかったため、公式readerと同じ1段の展開を追加。不正な内側JSONは失敗説明とRAWを残し、署名を未検証のまま扱う。

最終チェックは型チェックPASS、Vitest 141件PASS、従来ブラウザ6件PASS、実MV3合成9件PASS、Chrome/EdgeビルドPASS。実サイト接続はFAIL(403)、実作品・実API・原寸・実Edge・認証/年齢制限・cloud Inspect/フルComfyUIはNOT RUNです。[証跡](evidence/README.md)、[全検証状態](TEST_STATUS.md)、[再現手順](MANUAL_TESTS.md)。

今回の主な変更:

- `src/metadata/normalize.ts`, `tests/parser.test.ts`: Comment envelope修正と正例/不正JSON/過剰wrapperの回帰。
- `playwright.extension.config.ts`, `tests/extension/driver.ts`, `tests/extension/fixtures.ts`, `tests/extension/inspector.spec.ts`: 本番MV3の再現可能な試験。
- `scripts/verify-live.ts`, `scripts/reference-fixtures.py`, `tests/reference.test.ts`, `tests/reference/README.md`, `tests/reference/fixtures/*`: 実サイトの状態記録と独立fixtureによる照合。
- `package.json`, `.gitignore`: 開発コマンドと一時証跡の除外。依存やMV3権限は追加していない。
- `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/TEST_STATUS.md`, `docs/MANUAL_TESTS.md`, `docs/NOVELAI_RESEARCH.md`, `docs/RELEASE_CHECKLIST.md`, `docs/WORK_REPORT.md`, `docs/evidence/*`: 実測と限界、再現手順、状態だけの証跡。

Gate 1実サイト受入が完了していないため、Phase Cは公式ソースとfixture照合の準備までです。Stealth、V4/V5キャラクター別、署名検証、JPEG/WebP EXIFは実装していません。次は正規に閲覧できるテスト作品と接続環境で、single/multiと各データ形式を再現コマンドまたはGUI手順で確認します。今回の変更は未コミット。push・PR・公開は行っていません。
