# NovelAIの形式について

2026-11-19時点の調査と、実装の状況です。

## 参照した資料（バージョン固定）

- 公式リポジトリ [NovelAI/novelai-image-metadata](https://github.com/NovelAI/novelai-image-metadata) のコミット `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`（MIT License, Copyright 2023 NovelAI）
  - `nai_meta.py`（Stealthの読み取り）SHA-256 `49fc35c2…881c`
  - `nai_meta_writer.py`（Stealthの書き込み）SHA-256 `252eb0ef…ecec`
  - `nai_sig.py`（PNGのテキストの読み取りと署名の検証）SHA-256 `66716858…c326`
- 公式の画像APIの定義 `https://image.novelai.net/docs/doc.json`（2026-11-19に取得、SHA-256 `6c138b59…1415`）
  - `RequestParameters.v4_prompt` / `v4_negative_prompt` → `V4ConditionInput { caption: { base_caption, char_captions: [{ char_caption, centers: [{x, y}] }] }, use_coords, use_order, legacy_uc }`

ハッシュの全体は `tests/reference/fixtures/expected.json` と `scripts/reference-fixtures.py` にあります。公式のコードは、拡張にもこのリポジトリにも入れていません。自分で実装し、動作を突き合わせただけです。

## 実装したもの

| 機能 | 実装 | 確かめ方 |
|---|---|---|
| PNGのテキストのComment（1段のenvelopeを含む） | normalize.ts | 公式の `nai_sig.extract_png_text_metadata` で読んだ合成fixture |
| Stealth形式 `stealth_pngcomp` | stealth.ts | 公式の書き込み処理で作った合成画像（160×48、128×128）を公式の読み取り処理で読み、同じキーと値をこちらの実装でも得られることを確認 |
| V4 / V4.5のキャラクター別のプロンプトと位置 | normalize.ts の `v4Captions` | 公式APIの形式。合成したCommentを公式の書き込み・読み取り処理に通して、行き来できることを確認 |

### Stealth形式の読み方

公式の `nai_meta.py` と同じ方法です。

1. RGBAに変換したアルファの面を転置し、列の順に並べます。
2. 各画素の最下位ビットを上位ビットから8個ずつ取り、バイトにします。
3. 先頭の15バイトが `stealth_pngcomp`、次の4バイトが埋め込みデータのビット長（ビッグエンディアン）、その後ろがgzipで圧縮したUTF-8のJSONです。
4. `Comment` が文字列なら、それもJSONとして読みます。

FECのデータ（今のNovelAIは付けていません）は読みません。公式の読み取り処理は圧縮しない `stealth_pnginfo` を受け付けないので、この拡張も、あることを検出するだけで中身は読みません。

### こちらの実装の制限

- 読めるのは、8ビット・非インターレースのRGBAとグレー+アルファだけです。
- 16ビット、インターレース、パレット+tRNSは「未検査」と表示します。
- 上限: 圧縮データ1 MiB、展開後2 MiB、キー128個。

## 未実装: 電子署名の検証

`nai_sig.py` は、次のものをつなげて、組み込みの公開鍵でEd25519の署名を検証します。

- `signed_hash` を除いたCommentを、Pythonの `json.dumps` で文字列にしたもの。
- 画素のバイト列（RGB、またはアルファの最下位ビットを消したRGBA）。

ブラウザで同じ判定をするには、次のものが必要です。

1. Pillowと同じ画素のバイト列を作り直すこと。
   - 色の変換、16ビット、パレット、インターレースのすべてで一致させる必要があります。
   - Canvasに描き直せば一致する、とは考えません。
2. Pythonの `json.dumps` とバイト単位で同じになるシリアライズ。
   - 空白、Unicodeのエスケープ、数値の書き方、キーの順番まで合わせます。
3. Ed25519を検証する手段と、公開鍵の出どころの記録。
   - ブラウザが対応しているバージョンを確かめるか、監査済みの実装を使います。
4. テスト用の画像:
   - 正しく署名された画像（正しい例）。
   - 改変した画像、署名のない画像、偽装した画像（誤った例）。
   - テスト用の鍵で作った署名を、本番の公開鍵や「検証済み」の表示と結び付けてはいけません。

正しい例が用意できないので、まだ実装していません。この拡張は `verified` / `invalid` を出さず、署名のデータがあれば「未検証」、なければ「署名データなし」と表示します。作業の内容は[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)の1番に書いています。

## 突き合わせていないもの

- 実際にNovelAIで生成した画像。
- NovelAIのクラウドのInspect。
- 正しい署名。

fixtureはすべて自分で作った合成画像で、`Software=NovelAI` はテストのための自己申告です。
