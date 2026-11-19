# Implementation status and backlog

更新: 2026-11-19。完了済みの変更は[CHANGELOG.md](../CHANGELOG.md)、検証状況は[TEST_STATUS.md](TEST_STATUS.md)を参照してください。

## 現在地

| 領域 | 実装・合成試験 | 実pixiv |
|---|---|---|
| ホバー・複数枚・キーボード | 完了 | NOT VERIFIED（自動ブラウザはCloudflare確認画面で停止） |
| pages API | 完了（形状は実測と一致） | HTTP層のみ確認（200） |
| 原寸の明示取得 | 完了（Worker・制限・取消・cooldown） | 403（Refererなしを拒否）。方針により回避しない |
| ローカルファイル検査 | 完了 | 端末内処理のため実サイト非依存 |
| PNGテキスト / Stealth / V4キャラクター / JPEG・WebP EXIF | 完了（参照fixtureで照合） | 実際の生成画像では未照合 |
| NovelAI電子署名の検証 | 未実装 | — |

## バックログ（Issue化しやすい形）

以下はリポジトリ外への作成は行っていません。必要に応じてIssueへ転記してください。

### 1. 実機受入（通常のChrome）— `live`, `release-blocker`
- 背景: 自動ブラウザはdocumentでCloudflareの確認画面（`cf-mitigated: challenge`）になるため、実一覧での動作は人の操作で確認する必要があります。
- 受入条件: [MANUAL_TESTS.md](MANUAL_TESTS.md)の1〜9を、ログアウト・ログイン両方で記録すること。特に、プレビュー`<img>`が実タブで表示されること、各一覧ページでサムネイルが検出されること（検出されないDOM構造は個人情報を除いて記録）、Metadataで403の説明とローカル導線が出ること、ローカルファイル検査の結果が独立したreaderと一致すること。

### 2. 実Edge・最小対応版（120）— `live`
- 受入条件: Edge stableとChrome/Edge 120系で、ホバー・Metadata・ローカル検査・Stealth fixtureの読込が動作すること（`color-mix()`等のCSSを含む）。

### 3. NovelAI電子署名の検証 — `feature`, `needs-test-vector`
- 背景: 公式`nai_sig.py`は、`signed_hash`を除いたCommentのPython `json.dumps`の出力と画素バイト列（RGB、またはアルファLSBを消したRGBA）を連結し、組み込みの公開鍵でEd25519検証します。
- 必要なこと: (a) Pillowと同一の画素バイト列の復元（16-bit・パレット・インターレースの扱いを含む）、(b) Python `json.dumps`とバイト単位で一致するシリアライズ、(c) Ed25519（WebCryptoの対応ブラウザ版の確認、または監査済みの実装）、(d) 公開鍵の出所の記録、(e) **正当な署名付き画像による正例**（NovelAIの提供またはライセンス確認済みの画像）と、改変・署名欠落・偽装の負例。
- 受入条件: 公式スクリプトとブラウザ実装が、同じ画像集合で一致すること。正例がない間は`verified`を表示しない。

### 4. Stealthの対応形式の拡大 — `feature`
- 対象: 16-bit RGBA、Adam7インターレース、パレット+tRNS、グレー+tRNS。
- 受入条件: Pillowの`convert('RGBA')`と同じアルファ値になることを、公式readerとの比較fixtureで示すこと。

### 5. XMPの読み取り — `feature`, `evaluate`
- 対象: JPEG APP1 XMP、PNG iTXt `XML:com.adobe.xmp`、WebP `XMP `チャンク。
- 先に、生成ツールがXMPへ生成情報を書く実例（一次資料）を確認すること。XMLは上限付きの単純な抽出に限定し、外部実体を解決しないこと。

### 6. 実DOMに基づくサムネイル検出の回帰fixture — `compat`
- 受入条件: 実際の一覧のDOM構造（画像・作品名・作者名を合成値に置換したもの）を`tests/thumbnail.test.ts`に追加し、false negativeを再現・修正すること。推測でURL許可範囲を広げないこと。

### 7. 公開準備 — `release`
- GitHubのprivate vulnerability reportingを有効化。
- CIの`browser`ジョブがGitHub-hosted runnerで安定することを確認し、必要なら必須チェックにする。
- Chrome Web Store: 公開プライバシーポリシーURL、ストア用スクリーンショット（合成）、単一目的の説明、権限の説明、名称に含まれる第三者商標（pixiv）の扱いの確認、pixiv規約の確認。

### 8. 英語UI — `i18n`
- `_locales`と`browser.i18n`でUI文字列を外部化。判定語彙（メタデータから推定・未検証）の意味を変えないこと。

### 9. 429待機のWorker再起動耐性 — `ops`, `decision-needed`
- 現状: Workerのcooldownは再起動で失われるが、タブ側でも同じ待機を保持するため、同じタブからは早期の再取得をしない。別タブからは可能。
- 選択肢: `storage.session`で待機時刻だけを保持（`storage`権限の追加が必要。インストール時の警告はない）。権限を増やす判断が必要なため未実施。

## 実施しないこと

Referer/Origin操作、declarativeNetRequestによるヘッダー書換え、ページ文脈での原寸バイト取得、Cookie移植、外部proxy、自動再試行、一覧の巡回・先読み。push・公開・リリース・既存プロファイルへのインストールは明示的な依頼があるまで行いません。
