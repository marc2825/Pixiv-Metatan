# pixiv AI Metadata Inspector

pixivの作品サムネイルにマウスを合わせて画像をプレビューし、ユーザーが押したときだけ、そのページの画像に埋め込まれたAI生成メタデータを端末内で表示するChrome / Edge（Manifest V3）拡張です。

[English summary](#english-summary) · [検証状況](docs/TEST_STATUS.md) · [プライバシー](docs/PRIVACY.md) · [セキュリティ](SECURITY.md) · [設計](docs/ARCHITECTURE.md)

> [!IMPORTANT]
> **開発版（0.1.0、未リリース）です。** 自動試験はすべて合成データで実施しています。実pixivの一覧ページでの動作は未確認です（自動ブラウザはCloudflareの確認画面で止まるため）。
> 2026-11-19の実測では、画像配信サーバー（i.pximg.net）はRefererのない取得を拒否しました（HTTP 403）。この拡張は制限回避をしないため、**Metadataボタンで原寸を取得できないのが現状の想定動作**です。原寸のメタデータは「ローカルファイルを検査」で確認してください。

![合成データでのホバー表示と検査結果](docs/screenshots/hover-result.png)

## できること

- **ホバープレビュー**: 検索結果・ランキング・ユーザーの投稿・ブックマーク・フォロー新着・関連作品などで、作品画像に約250ms合わせるとプレビューを開きます。複数枚の作品は、ホイール・前後ボタン・左右キーでページを切り替えられます。
- **明示的な検査**: **Metadata**を押したときだけ、表示中ページの原寸画像1枚を取得して解析します。ページを切り替えただけでは取得しません。
- **ローカルファイル検査**: 正規に保存した画像ファイルを選んで、同じ解析器で確認できます。
- **作品ページ**: 右下の`AI Metadata`から、ページを選んで検査する従来パネルも使えます。

## 対応しているメタデータ

| 形式 | 読み取る内容 |
|---|---|
| PNG テキスト（tEXt / zTXt / iTXt） | NovelAI（Comment、1段のComment envelope、V4/V4.5のキャラクター別Prompt・位置）、ComfyUI（prompt / workflow）、AUTOMATIC1111 / Forge（parameters） |
| PNG アルファチャンネル | NovelAIのStealth形式（`stealth_pngcomp`）。8-bit・非インターレースのRGBA / グレー+アルファのみ |
| JPEG / WebP の EXIF | AUTOMATIC1111 / Forge（UserComment）、ComfyUI WebP（Model / Make の `prompt:` / `workflow:`）、ImageDescription・Software等 |

Prompt / Negative / Seed / Steps / Sampler / CFG / Model などを、記録されている範囲で表示します。ComfyUIのグラフから単一のPromptやモデルを推測することはしません。

### 判定の意味（重要）

- 表示は「**メタデータから推定**」です。生成情報は自己申告であり、誰でも編集・削除できます。
- **NovelAIの電子署名は検証していません。** 署名データがあっても「未検証」と表示し、「検証済み」にはしません。
- メタデータが**ない**こと、**未対応形式**であること、**取得できない**ことは、人間が描いた証拠ではありません。画像の加工・変換・投稿サービスで情報は失われます。

## インストール（開発版）

Node.js 22.22.2以降の22系、24.15以降の24系、または26以降が必要です（試験用のjsdomの要件）。

```bash
npm ci
npm run build        # Chrome: .output/chrome-mv3/
npm run build:edge   # Edge:   .output/edge-mv3/
```

1. Chromeは`chrome://extensions`、Edgeは`edge://extensions`を開き、デベロッパーモードを有効にします。
2. 「パッケージ化されていない拡張機能を読み込む」で上記の出力フォルダを選びます。
3. 開いているpixivのタブを再読み込みします。

## 使い方

1. pixivの一覧で作品画像にマウスを合わせる（またはTabで作品リンクにフォーカスする）と、約250ms後にプレビューが開きます。サムネイルとプレビューの両方から離れると約200ms後に閉じます。Escapeでも閉じます。
2. 複数枚の作品は、画像の上でホイールを回すか、前後ボタン・左右キーでページを切り替えます（`2 / 8`のように表示）。キーボードでは作品リンクで↓キーを押すとプレビューに入れます。
3. **Metadata**を押すと、表示中ページの原寸画像1枚だけを取得・解析します。結果はタブ内のメモリで最長2分だけ再利用します。
4. 取得できない場合（403 / 429など）でもプレビューはそのまま使えます。原寸を確認するには、pixivの作品ページで原寸画像を表示してブラウザで保存し、**ローカルファイルを検査**で選んでください。選んだファイルが表示中の作品と同じ画像かどうかは確認しません。
5. Prompt・Negativeは見出し横の「コピー」、全体は「結果をコピー」「正規化JSONをコピー」で、クリックしたときだけクリップボードへコピーします。

## 制限

- ページ情報はpixivの未文書化API（`/ajax/illust/{id}/pages`）に依存します。形式が変わると、安全のため表示・検査を拒否する場合があります。
- 一覧の作品検出は、作品リンク（`/artworks/{id}`）と同じ作品IDを含むpximgサムネイルの組み合わせが必要です。実pixivのDOMでの網羅性は未確認です。
- GIF・うごイラなど、原寸URLの形式が対応外のページはプレビューのみです。
- 上限: ファイル48 MiB、テキスト2 MiB、40百万画素、Stealthデータ（圧縮）1 MiB。通信は15秒で打ち切ります。原寸の取得は全タブで同時に1件です。
- 未実装: NovelAI電子署名の暗号学的検証、XMP / IPTC、APNG・アニメーションの画素、16-bit・インターレースPNGのStealth。
- UIは日本語のみです。

## プライバシー

- 接続先はpixiv（www.pixiv.net）と画像配信サーバー（i.pximg.net）だけです。画像・Prompt・ファイル名を外部へ送信しません。テレメトリー・広告・解析ツールはありません。
- Cookie・パスワード・トークンを読み出しません。原寸の取得は認証情報・Refererを付けずに行います。
- 結果はタブ内のメモリにだけ一時保存し、ディスクや拡張ストレージには保存しません。
- 一覧の巡回、原寸の先読み、自動再試行、ログイン・年齢制限・ホットリンク制限・レート制限の回避は行いません。

詳細は[プライバシー説明](docs/PRIVACY.md)を参照してください。

## 開発

```bash
npm run typecheck
npm test                  # Vitest（単体・DOM・参照fixture）
npm run build && npm run build:edge && npm run check:manifest
npx playwright install chromium
npm run test:browser      # 合成ページでのUI試験
npm run test:extension    # 本番MV3ビルドを使い捨てプロファイルで試験（通信はすべて合成）
```

LinuxではPlaywrightのブラウザ依存ライブラリが必要です（`npx playwright install --with-deps chromium`）。既存のChromeを使う場合は`PAMI_CHROME_PATH`を指定します。実サイトでの確認は[手動検証手順](docs/MANUAL_TESTS.md)を参照してください。CIは`.github/workflows/ci.yml`で型チェック・単体試験・Chrome/Edgeビルド・権限チェックを実行します。

参照fixtureの再生成手順は[tests/reference/README.md](tests/reference/README.md)にあります。変更履歴は[CHANGELOG.md](CHANGELOG.md)、未完了の作業は[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)です。

## ライセンス・帰属

[MIT License](LICENSE)。配布物に含まれる第三者コードはWXTの小さなランタイム（MIT）だけです。

Stealth形式の読み取りは、NovelAIの公式参照実装（[NovelAI/novelai-image-metadata](https://github.com/NovelAI/novelai-image-metadata)、MIT）の挙動に合わせた独自実装です。コードはコピーしていません。

pixiv、NovelAI、ComfyUI、AUTOMATIC1111とは関係ありません。リポジトリには第三者の作品画像・R18画像を含めていません（試験画像はすべて自作の合成画像です）。

---

## English summary

A Chrome/Edge Manifest V3 extension for pixiv. Hover a thumbnail to preview the artwork (all pages, with wheel/arrow navigation). Press **Metadata** to fetch and parse exactly one original image locally, or inspect a file you saved yourself.

- **Reads**: PNG text (NovelAI incl. V4/V4.5 character captions, ComfyUI, AUTOMATIC1111/Forge), NovelAI alpha-channel Stealth (`stealth_pngcomp`), and JPEG/WebP EXIF (AUTOMATIC1111/Forge UserComment, ComfyUI WebP tags).
- **Does not**: verify NovelAI signatures (claims are shown as *unverified*), treat missing metadata as proof of human authorship, crawl listings, prefetch originals, retry automatically, read cookies, spoof headers or use proxies.
- **Live status (2026-11-19)**: synthetic tests pass. Live pixiv listing behaviour is not yet verified, because automated browsers receive a Cloudflare challenge. i.pximg.net rejects referer-less requests (403), so the **Metadata** fetch is expected to fail on real pixiv. Use **Local file** with an image you saved from pixiv's own viewer.
- **Privacy**: talks only to www.pixiv.net and i.pximg.net; no telemetry, no storage, no uploads. See [PRIVACY](docs/PRIVACY.md).

Build: `npm ci && npm run build`, then load `.output/chrome-mv3/` (or `.output/edge-mv3/` from `npm run build:edge`) as an unpacked extension. The UI is Japanese only. MIT licensed. Not affiliated with pixiv or NovelAI.
