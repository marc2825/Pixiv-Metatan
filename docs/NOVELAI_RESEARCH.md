# Gate 2: NovelAI公式実装の調査

更新: 2026-10-23。**Gate 2機能の移植と正当な署名の照合はNOT RUN**。Gate 1の実サイト受入までStealth/署名/キャラクター別解析の実装を保留しています。通常PNG readerの実行と、明白な偽署名の拒否だけをローカルで照合しました。

## 参照を固定

公式リポジトリ: [NovelAI/novelai-image-metadata](https://github.com/NovelAI/novelai-image-metadata)

参照コミット: `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`（2026-08-20）。通常PNGについて公式Python readerを人工1×1画像で実行しました。第三者画像や正当な署名付き画像は取得していません。

- [nai_meta.py](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/nai_meta.py)
- [nai_sig.py](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/nai_sig.py)
- [MIT License](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/LICENSE) (Copyright 2023 NovelAI)

Stealth/暗号学的検証は製品に移植していません。通常テキストの1段のComment envelopeは公式readerの挙動に合わせて修正しました。将来コードを移植する場合はMITライセンス全文と帰属を同梱し、参照コミットと変更点を記録してください。

## Gate 1品質改善のための実行結果

`scripts/reference-fixtures.py`は参照ソースのSHA-256を検証し、公式の通常PNG readerとComfyUI SaveImageをローカルで使います。Comment envelopeを従来の正規化が読めないことを再現し、修正後にRAW・共通Prompt・Negative・Seed等の一致を確認しました。64-byteゼロ署名は公式verifierでfalseでしたが、本拡張にはverifierがないためnot-checkedのままです。正当な署名の正例は未確認であり、verifiedの根拠にはしません。[fixtureの出所](../tests/reference/README.md)。

## 確認した形式

`nai_meta.py`はアルファを転置後に並べ、各LSBを上位ビットから8個ずつバイトにします。`stealth_pngcomp`、32-bit big-endianのビット長、gzip圧縮されたUTF-8 JSONを取り出します。選択した公式版のこの関数は`stealth_pnginfo`を受け付けません。非圧縮形式の互換性を主張するには別途一次資料と照合が必要です。

`nai_sig.py`は`Comment`から署名値を取り除き、PythonのJSONエンコードと画素バイト列を連結して、組み込み公開鍵に対するEd25519署名を検証します。RGBと、alpha LSBを消去したRGBAの候補を扱います。署名文字列単体やSoftwareだけの判定ではありません。通常PNGテキスト・WebP EXIFの取得処理も存在します。

## 実装前に必要なこと

1. 色変換・premultiplied alpha・16-bit/パレット/インターレースを含め、署名対象の画素バイトをPillowと同一に復元する方法を決める。Canvasでの再描画だけで一致すると仮定しない。
2. 40百万画素/展開後バイト予算を維持し、Stealthの長さ・gzip・JSONも制限する。Worker内の純粋なデコーダが可能なら、新たなoffscreen権限を加えない。
3. PythonのJSON空白、Unicodeエスケープ、数値、キー順序を再現し、JSの標準JSON.stringifyと同じと仮定しない。
4. ローカル生成のテスト鍵による署名fixtureを使う場合、それを本番のNovelAI公開鍵やverified表示に接続しない。本番鍵に対する正例の検証も必要。
5. 同じ権利処理済み画像に対する公式Python検証とブラウザ検証をクロスチェックする。改変、署名欠落、署名偽装、メタデータ競合を含める。
6. キャラクターPromptはv4_prompt / v4_negative_prompt等の共通captionとchar_captionsを区別し、対応する公式サンプルのスキーマでテストする。現在はRAW保持のみ。

これらの条件が未充足のため、現実装は`verified` / `invalid`を出しません。通常テキストに署名申告があればnot-checked、なければ通常テキストに限定したnot-presentです。
