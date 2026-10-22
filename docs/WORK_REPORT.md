# 作業報告 — 2026-10-22

Gate 1の実装と自動検証まで実施しました。実pixiv・Chrome/Edge実拡張の受入はNOT RUNで、リリースはNO-GOです。Gate 2は公式ソースを調査し、実装前提を整理しました。全機能完成や署名検証済みとは主張していません。

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
