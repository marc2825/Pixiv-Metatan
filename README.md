# pixiv AI Metadata Inspector

pixivの作品ページで、ユーザーが選んだ1枚の原寸画像に含まれるAI生成メタデータを表示するChrome / Edge MV3拡張です。画像の見た目からAI生成を判定するものではありません。

**状態: Gate 1は実MV3拡張と合成応答で検証済み。実pixivはトップページHTTP 403で、作品・原寸の受入は未完了です。リリース判定はNO-GO。** Gate 2のStealth・署名検証等も残っています。[検証記録](docs/TEST_STATUS.md)と[実機確認手順](docs/MANUAL_TESTS.md)を参照してください。

## 開発・ビルド

Node.js 22以降（今回の検証: 22.14.0）、npmを使用します。

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:edge
```

`npm ci` / `npm test`はWXTの型定義を準備します。依存関係は`package-lock.json`で固定しています。出力は`.output/chrome-mv3/`と`.output/edge-mv3/`です。

`test:browser`はUI・解析・取得処理をテスト用アダプタで接続します。`test:extension`は本番ビルドを使い捨てプロファイルへ読み込み、本物のcontent script・runtime messaging・service workerを検査します。両者とも応答は合成です。`verify:live`は実サイト用で、画像やPromptを保存しません。

```bash
npx playwright install chromium
npm run test:browser
# 既存のChrome for Testingを使う場合:
PAMI_CHROME_PATH=/path/to/chrome npm run test:browser
# 本番ビルドを一時プロファイルで読み込む実MV3試験（応答は合成）:
PAMI_CHROME_PATH=/path/to/chrome npm run test:extension
# 実pixivを選択ページ1枚で確認（通常接続、無再試行、証跡は状態のみ）:
PAMI_CHROME_PATH=/path/to/chrome npm run verify:live -- --url https://www.pixiv.net/artworks/ARTWORK_ID --page 0
```

## 利用手順（実機確認待ち）

1. ご自身で`chrome://extensions`または`edge://extensions`を開き、開発者モードで該当の出力ディレクトリを読み込みます。
2. 正規に閲覧できるpixiv作品ページで、右下の`AI Metadata`を押します。この操作で作品の画像一覧だけを取得します。
3. 対象のページ番号を選んで「元画像を検査」を押すと、その1枚だけを取得します。並列取得・先読み・自動再試行はありません。
4. 取得拒否や通信失敗時は、pixivで正規に保存できる元画像を「ローカルファイルを検査」で選択します。JPEG/WebPは形式を識別し、解析未対応と表示します。
5. 結果、正規化JSON、対象URLはそれぞれ明示操作でコピーできます。RAWやComfyUIのグラフは折り畳み表示です。

ページ変更・取り消し・閉じる操作は実行中処理を中止します。SPA遷移では古い候補と結果を破棄し、「画像一覧を取得」で新しい作品の一覧を読み込みます。Escapeで閉じ、ボタンへフォーカスを戻します。

## 実装済み

- PNG tEXt / zTXt / iTXt（非圧縮・圧縮）、CRC、チャンク境界・構造の確認。Latin-1とUTF-8を区別。
- NovelAI通常メタデータ（公式reader互換の1段のComment envelopeを含む）、ComfyUI APIグラフ・workflow、AUTOMATIC1111/Forge互換parametersの表示。混在時は複数の根拠を保持。
- 共通Prompt / Negative / Seed / Steps / Sampler / CFG / Model等、存在する値のみ正規化。ComfyUIから単一のプロンプトやモデルを推測しません。
- 重複チャンクはRAWに全件保持し、曖昧なキーは判定から除外。署名の自己申告は常に未検証。
- 48 MiBの受信・ローカルファイル上限、2 MiBの圧縮前および展開後テキスト予算、40百万画素の寸法上限、JSON深さ・ノード数制限。
- 作品・ページ・送信元の検証、15秒タイムアウト、サービスワーカー全体で1件の検査、キャンセル、失敗理由とローカル読込案内。
- 閉じたShadow DOM、テキストだけの描画、キーボード操作、ダークモード、狭幅レイアウト。

## 未実装・制限

- NovelAI Stealth PNG、V4/V5のキャラクター別Prompt、暗号学的署名検証、JPEG/WebP EXIFは未実装です。キャラクター情報が通常PNGテキストに含まれる場合、RAWでは保持されます。
- `signed_hash`は真偽を示しません。本実装が`verified` / `invalid`を生成する経路はありません。`not-present`は**解析した通常テキスト**に署名が見つからない状態です。
- PNGの画素は展開しません。CRC・構造検証の成功は、画素の正常性や生成元の証明ではありません。APNGのアニメーションも解析しません。
- `/ajax/illust/{id}/pages`は非公式・未文書化のエンドポイントです。原寸URLの形が変われば手動読込へ切り替えます。
- ホスト権限があってもpximgが403を返す可能性があります。実際の200/403、ログイン状態、年齢制限付きの正規閲覧、Chrome/Edge実拡張動作は未検証です。
- メタデータは削除・編集できます。不在・未対応・取得不能は、人間が描いたことの証拠にはなりません。

## プライバシー

画像・プロンプトは端末内だけで処理し、永続保存・外部アップロード・テレメトリーを行いません。接続先は操作対象のpixivとpximgだけです。Cookieやトークンを読み取らず、pixivの同一オリジンAPIではブラウザの通常セッションを利用し、pximg取得では認証情報を付けません。

[プライバシー説明](docs/PRIVACY.md) / [セキュリティ方針](SECURITY.md) / [実装設計](docs/ARCHITECTURE.md) / [実装順序](docs/IMPLEMENTATION_PLAN.md) / [変更報告](docs/WORK_REPORT.md)

pixiv、NovelAIとの提携はありません。第三者の作品画像やR18画像をテストに含めていません。
