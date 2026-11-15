# pixiv AI Metadata Inspector

pixivの作品サムネイルにホバーして画像をプレビューし、必要なページのAI生成メタデータを確認するChrome / Edge MV3拡張です。画像やプロンプトは端末内で解析します。

**開発版・実pixiv受入は未完了です。** 合成応答でUIと本番MV3経路を検証済みですが、2026-11-15の実pixiv接続はトップページでHTTP 403でした。作品API・原寸取得・実際の一覧DOM・実Edgeは未確認です。[検証状態](docs/TEST_STATUS.md)

## インストール

Node.js 22以降とnpmを用意し、このディレクトリで実行します。

```bash
npm ci
npm run build
# Edge用
npm run build:edge
```

Chromeの`chrome://extensions`、またはEdgeの`edge://extensions`を開き、「デベロッパーモード」を有効にします。「パッケージ化されていない拡張機能を読み込む」から、Chromeでは`.output/chrome-mv3/`、Edgeでは`.output/edge-mv3/`を選びます。すでに開いているpixivのタブは再読み込みしてください。

## 使い方

1. pixivの検索結果、ランキング、ユーザーの投稿・ブックマーク、フォロー新着などで、作品画像にマウスを合わせます。約250ms後にプレビューが開きます。
2. 複数枚作品は、画像の上でホイールを下／上に回すと次／前のページへ進みます。前後ボタン、画像にフォーカスした状態の左右キーも使えます。ページ番号は`2 / 8`のように表示します。
3. **Metadata**を押すと、表示中のページの原寸画像1枚だけを取得・解析します。ページ切替だけでは解析しません。結果はタブ内で最大2分、容量・件数の上限付きで再利用します。
4. 401 / 403 / 429などで原寸を取得できなくても、表示可能なプレビューは継続します。「ローカルファイルを検査」から正規に保存できる元画像を選べます。選択ファイルと表示作品の一致は拡張では確認しません。
5. Prompt、Negative、結果、JSONはボタンでコピーできます。ComfyUIグラフ・RAW・対象URLは折り畳み表示です。

サムネイルからプレビューへマウスを移動して操作できます。両方から離れると約200ms後に閉じます。Escapeでも閉じられ、元の作品リンクへのクリックは通常どおり動きます。作品リンクへのキーボードフォーカスでも開けます。下矢印でプレビュー内へ移動し、TabでMetadataなどの操作に進めます。

作品詳細ページでは右下の`AI Metadata`から従来のページ選択・ローカル読込も使えます。関連作品は同じホバー操作に対応します。一覧ページには固定ボタンを追加しません。

## 対応範囲と制限

- PNG tEXt / zTXt / iTXt、CRC・構造検証、圧縮テキストの上限付き展開。NovelAI通常PNG（1段のComment envelopeを含む）、ComfyUIグラフ、AUTOMATIC1111 / Forge形式を表示します。
- Prompt / Negative / Seed / Steps / Sampler / CFG / Model / VAE / LoRA関連値など、既存解析器が抽出できる情報だけを表示します。ComfyUIから単一のPromptや生成モデルを推測しません。
- ファイル48 MiB、通常テキスト2 MiB、寸法40百万画素、JSON深さ・ノード数の上限があります。原寸取得・解析は複数タブを含め1件、通信は15秒でタイムアウトします。
- **Stealth PNG、V4/V5キャラクター別Prompt、JPEG / WebP EXIF、暗号学的署名検証は未実装**です。PNGの画素は展開しません。署名文字列が存在しても検証済みにはしません。
- 生成情報は編集・削除できる自己申告です。メタデータの不在・未対応・取得不能は、人間が描いた証拠ではありません。
- ページ情報は未文書化の`/ajax/illust/{id}/pages`に依存します。作品リンク内の安全なpximg画像と作品IDを識別できないカードは対象外です。プレビューURLがないページでは原寸に代替せず、作品ページへのリンクを案内します。
- 通常の画像表示と、解析用に画像バイト列を読み取る処理は異なります。ホスト権限はサーバーの取得許可を保証しません。原寸403の解消を保証する変更ではありません。

## 開発・検証

```bash
npm run typecheck
npm test
npm run build
npm run build:edge
npx playwright install chromium
npm run test:browser
npm run test:extension
```

`test:browser`はテスト用アダプタ、`test:extension`は本番ビルドを使い捨てプロファイルに読み込みます。どちらもHTTP応答は自作の合成データです。必要なら`PAMI_CHROME_PATH=/path/to/chrome`を指定します。LinuxではPlaywrightのブラウザ依存ライブラリも必要です。

実サイト確認は[手動検証手順](docs/MANUAL_TESTS.md)を参照してください。`npm run verify:live -- --url https://www.pixiv.net/`は新規プロファイルで通常接続だけを確認し、拒否時に停止します。画像・Prompt・RAW・認証情報は証跡に保存しません。

## プライバシー

接続先はpixivとpximgだけです。APIはブラウザの通常の同一オリジンセッションを利用し、原寸のWorker取得は認証情報を付けません。Cookie・トークン・履歴を読み出しません。画像・結果の永続保存、外部アップロード、テレメトリー、一覧の巡回、原寸の先読み、制限回避はありません。画像表示にはブラウザの通常HTTPキャッシュが利用される場合があります。

[プライバシー](docs/PRIVACY.md) / [セキュリティ](SECURITY.md) / [設計](docs/ARCHITECTURE.md) / [作業報告](docs/WORK_REPORT.md)

pixiv、NovelAIとの提携はありません。テストには第三者の作品画像やR18画像を含めていません。
