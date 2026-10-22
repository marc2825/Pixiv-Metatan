# Verification status — 2026-10-22 (JST)

## Gate判定

| Gate | 判定 | 根拠 |
|---|---|---|
| Gate 0 開発環境 | GO | 依存導入、型チェック、テスト、Chrome/Edgeビルド成功 |
| Gate 0 実pixivの実現可能性 | NOT RUN | 認証済み実ブラウザでAPI/pximg/拡張注入を未確認 |
| Gate 1 ローカル実装・自動検証 | GO | P0実装、129件のVitest、6件の合成Chromeテスト |
| Gate 1 リリース | NO-GO | 実pixivとChrome/Edge実拡張の受入未実施 |
| Gate 2 | NO-GO / 未実装 | Gate 1実機受入待ち。公式実装の調査のみ |

## 最終結果

| コマンド / 検証 | 結果 | 証拠・範囲 |
|---|---|---|
| `npm run typecheck` | PASS | WXT prepare + TypeScript strict/noUncheckedIndexedAccess |
| `npm test` | PASS | 5 test files / 129 tests |
| `npm run build` | PASS | `.output/chrome-mv3/`, MV3, 約39.14 kB |
| `npm run build:edge` | PASS | `.output/edge-mv3/`, MV3, 約39.14 kB |
| `npm run test:browser` | PASS | Playwright 6件、Chrome for Testing 155.0.8059.84 |
| 生成manifest・ソースの権限確認 | PASS | permissionsは空、hostはpixiv/pximgのみ。remote JS/保存/追跡/汎用fetch橋なし |
| `git diff --check` | PASS | whitespace errorsなし |
| 実pixiv API / 原寸200/403/429 | NOT RUN | 合成応答を実ネットワーク成功として扱っていない |
| インストール済みMV3拡張のChrome/Edge試験 | NOT RUN | ユーザープロファイルにインストールしていない |
| ログイン/ログアウト/正規の年齢制限作品 | NOT RUN | 実アカウント/実作品を使用していない |
| 最低Chrome/Edge 120での実機確認 | NOT RUN | Chrome互換のsendResponse方式をunitで確認したのみ |
| Stealth・キャラクター別Prompt・JPEG/WebP EXIF・署名照合 | NOT RUN | 未実装。公式Pythonを実行していない |

最終実行に未解消のFAILはありません。上記NOT RUNは未解決のリリース条件です。

## 実行環境

- Linux x64、Node.js 22.14.0、npm 10.9.2。
- PATHにNode/npmがなかったため、ローカル配布物を`/tmp/pami-tools/node-v22.14.0-linux-x64/`へ展開。通常の開発環境ではNodeをPATHに設定してください。
- TypeScript 5.9.3、WXT 0.21.4、Vitest 5.0.5、Vite 8.3.5、Playwright 1.64.1（lockfile参照）。
- ブラウザ試験は`PAMI_CHROME_PATH=/tmp/cp-tree-tools/chrome-linux64/chrome`を指定。最初は実行サンドボックスがChromeのソケット利用を拒否し起動に失敗。その制限外で一時テスト用ブラウザを実行した。
- テストは全通信をPlaywrightで遮断・合成応答化。既存ユーザープロファイル・認証情報・実画像は使用せず、拡張もインストールしない。

## テストで確かめたこと

- 独立実装のCRCとNode zlibで生成した人工PNG。tEXt/zTXt/iTXt、UTF-8、日本語、Latin-1、重複キー、prototype-likeキー、偽signed_hash、混在ツール、メタなし。
- 不正CRC、チャンク長・順序・IHDR/PLTE/IEND、切断、文字コード、圧縮方式、壊れたzlib、展開爆弾、48 MiB/2 MiB/40百万画素/件数上限、JSON深さ・ノード数。
- NovelAI通常項目、ComfyUI workflow-only/APIノードとRAW保持、A1111/Forgeの複数行Prompt/Negativeと引用符内カンマ。
- 作品1/10枚と順序、APIスキーマ不正、ID/ページ不一致、外部ドメイン、認証URL、ポート、query/hash/encoded pathなどの拒否。
- 401/403/404/429/500、HTML/MIME不一致、サーバーのJPEG化、ネットワーク失敗、リダイレクト、Content-Length欠落/偽装、ストリーム停止・超過・タイムアウト。
- タブ・リクエスト所有者付き取消、複数タブを含む単一実行枠、現在タブの再確認、SPA中の古い一覧・結果の破棄。
- 注入1回、Inspect前の取得なし、危険HTMLを文字列表示、RAW、コピー内容・拒否、Escape、フォーカス、BFCache、破棄時の取消。
- 通信入口のunit testで、Chrome 120を含む従来API向けのliteral true + sendResponseによる非同期応答とtabsイベント接続を確認。
- Playwrightで実Chromeのnative DecompressionStream/File.stream、明示ファイル選択、ネイティブ展開爆弾の上限、403/429 fallback、SPA、360px幅・ダーク・キーボードを確認。

ブラウザ試験はテスト専用アダプタを用い、閉じたShadow DOMを検査用に開きます。実際のcontent script隔離・host permission・サービスワーカー寿命はこの試験の対象外です。[合成スクリーンショット](screenshots/synthetic-dark-mobile.png)。

## 初期状態と修正履歴

- 初期のNode不在を解消後、スターターの型チェック・7件のテスト・ビルドはPASS。
- 生成前の`.wxt/tsconfig.json`がない状態では単独テストがFAIL。postinstall/pretestでWXT prepareを実行するよう修正。
- 追加テストの型エラーは修正済み。
- 合成Chrome試験で、Inspectをdisabledにするとフォーカスが外れてEscapeで閉じられない不具合を検出し修正。再試験5件PASS。
- Chrome公式ドキュメントとバンドルを照合し、Promiseを返すメッセージlistenerを旧Chrome互換のsendResponse方式に修正。

実機確認は[MANUAL_TESTS.md](MANUAL_TESTS.md)を使用してください。コミット・push・PR・一般公開は実施していません。
