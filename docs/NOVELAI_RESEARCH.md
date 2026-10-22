# Gate 2: NovelAI公式実装の調査

調査日: 2026-10-22。**移植・署名照合はNOT RUN**。Gate 1の実機受入がGOになるまで、Stealth/署名/キャラクター別解析の実装を保留しています。

## 参照を固定

公式リポジトリ: [NovelAI/novelai-image-metadata](https://github.com/NovelAI/novelai-image-metadata)

参照コミット: `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`（2026-08-20）。公開ソースの読取のみ。Pythonは実行せず、第三者画像も取得していません。

- [nai_meta.py](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/nai_meta.py)
- [nai_sig.py](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/nai_sig.py)
- [MIT License](https://github.com/NovelAI/novelai-image-metadata/blob/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1/LICENSE) (Copyright 2023 NovelAI)

現コードにこれらの実装を移植していません。移植時にはMITライセンス全文と帰属を同梱し、参照コミットと変更点を記録してください。

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
