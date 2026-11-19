# NovelAI形式の調査と実装状況

更新: 2026-11-19。

## 参照した一次資料（固定）

- 公式リポジトリ [NovelAI/novelai-image-metadata](https://github.com/NovelAI/novelai-image-metadata) コミット `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`（MIT License, Copyright 2023 NovelAI）
  - `nai_meta.py`（Stealth reader）SHA-256 `49fc35c2…881c`
  - `nai_meta_writer.py`（Stealth writer）SHA-256 `252eb0ef…ecec`
  - `nai_sig.py`（PNGテキストreader・署名verifier）SHA-256 `66716858…c326`
- 公式画像APIの定義 `https://image.novelai.net/docs/doc.json`（2026-11-19取得、SHA-256 `6c138b59…1415`）: `RequestParameters.v4_prompt` / `v4_negative_prompt` → `V4ConditionInput { caption: { base_caption, char_captions: [{ char_caption, centers: [{x, y}] }] }, use_coords, use_order, legacy_uc }`

完全なハッシュは`tests/reference/fixtures/expected.json`と`scripts/reference-fixtures.py`にあります。公式コードは拡張にもリポジトリにも含めていません（独自実装・挙動の照合のみ）。

## 実装済み

| 機能 | 実装 | 照合方法 |
|---|---|---|
| PNGテキストのComment（1段のenvelopeを含む） | normalize.ts | 公式`nai_sig.extract_png_text_metadata`で読んだ合成fixture |
| Stealth `stealth_pngcomp` | stealth.ts | 公式writerで作った合成画像（160×48 / 128×128）を公式readerで読み、同じキー・値をJS実装で再現 |
| V4/V4.5のキャラクター別Prompt・位置 | normalize.ts `v4Captions` | 公式APIスキーマ。合成Commentを公式writer/readerに通して往復を確認 |

Stealthの読み方（公式`nai_meta.py`と同じ）: RGBAへ変換したアルファ面を**転置**して（列優先で）並べ、各LSBを上位ビットから8個ずつバイトにします。先頭15バイトが`stealth_pngcomp`、続く4バイトがペイロードのビット長（big-endian）、その後がgzip圧縮されたUTF-8 JSONです。`Comment`が文字列なら、さらにJSONとして読みます。FECデータ（現在NovelAIは付加しない）は読みません。公式readerは非圧縮の`stealth_pnginfo`を受け付けないため、この拡張も検出のみで内容は解析しません。

JS実装の制限: 8-bit・非インターレースのRGBA / グレー+アルファだけ（16-bit、インターレース、パレット+tRNSは未検査と表示）。圧縮ペイロード1 MiB、展開後2 MiB、キー128個まで。

## 未実装: 電子署名の検証

`nai_sig.py`は、`signed_hash`を除いたCommentのPython `json.dumps`の出力と、画素のバイト列（RGB、またはアルファのLSBを消したRGBA）を連結し、組み込みの公開鍵でEd25519署名を検証します。ブラウザで同じ判定をするには次が必要です。

1. Pillowと同じ画素バイト列の復元（色変換、16-bit、パレット、インターレース）。Canvasの再描画で一致すると仮定しない。
2. Python `json.dumps`（空白、Unicodeエスケープ、数値表現、キー順）とバイト単位で一致するシリアライズ。
3. Ed25519の検証手段（対応ブラウザ版の確認、または監査済みの実装）と、公開鍵の出所の記録。
4. **正当な署名付き画像による正例**と、改変・署名欠落・偽装の負例。テスト用の鍵で作った署名を本番の公開鍵や「検証済み」表示に結び付けない。

正例を用意できないため実装していません。この拡張は`verified` / `invalid`を出さず、署名データがあれば「未検証」、なければ「署名データなし」と表示します（作業項目は[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)の3）。

## 照合していないもの

実際のNovelAIで生成された画像、NovelAIのクラウドInspect、正当な署名。fixtureはすべて自作の合成画像で、`Software=NovelAI`は試験用の自己申告です。
