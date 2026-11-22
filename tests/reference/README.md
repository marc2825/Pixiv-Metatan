# 参照用の合成fixture

ここにあるファイルは、すべてこのプロジェクトで作ったものです。画像は1×1の黒い画素か、小さな決まったグラデーションで、メタデータはテスト専用です。

- 実際に生成した画像や、他の人の作品はありません。
- `Software=NovelAI` は、テストのための自己申告です。
- 正しいNovelAIの署名は含まれていません。

どのfixtureも、上流の変更していないコードで書き込み、もう一度読み戻してから、期待値を `expected.json` に記録しています。

- 実行するのは小さな関数やクラスだけで、パスや設定は差し替え用の簡単な部品でまかなっています。
- 次のものは動かしていません: モデル、アカウント、クラウドのサービス、ComfyUIのサーバー、Stable Diffusion WebUI。

| fixture | 書き込み | 読み戻し |
|---|---|---|
| `novelai-normal.png`、`novelai-wrapped-comment.png`、`novelai-invalid-signature.png` | Pillowの `PngInfo` | NovelAIの `nai_sig.extract_png_text_metadata` / `decoded_comment`。ゼロの署名は `nai_sig.verify_metadata_is_novelai` が拒否する |
| `novelai-stealth-only.png`（160×48、アルファのみ）、`novelai-v4-text-and-stealth.png`（128×128、テキストとアルファ） | NovelAIの `nai_meta_writer.inject_data` | NovelAIの `nai_meta.extract_image_metadata` |
| `rgba-pattern-no-stealth.png` | Pillow | NovelAIの `nai_meta` が目印を見つけられないこと |
| `comfy-saveimage.png` | ComfyUIの `SaveImage`（nodes.py） | PillowでPNGのテキストを読む |
| `comfy-exif.webp` | ComfyUIの `ImageSaveHelper._create_webp_metadata`（comfy_api/latest/_ui.py）と、同じPillowの保存の呼び出し | Pillowの `getexif()` |
| `a1111-exif.jpg`、`a1111-exif.webp` | AUTOMATIC1111 v1.10.1の `save_image_with_geninfo` | AUTOMATIC1111の `read_info_from_image` |
| `no-metadata.png`、`synthetic.jpg` | Pillow | — |

V4 / V4.5のキャラクター別のキャプションは、NovelAI公式の画像APIの形式（`RequestParameters.v4_prompt` → `V4ConditionInput`）に従っています。この形式はSHA-256と一緒に `expected.json` に記録していますが、コードとして実行はしていません。

上流のソース（スクリプトが、何かを実行する前にハッシュを確かめます）:

- NovelAI
  - コミット: `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`
  - ファイル: `nai_sig.py`、`nai_meta.py`、`nai_meta_writer.py`
  - ライセンス: MIT
- ComfyUI
  - コミット: `d07dff4565ea9804277fff8cdfa0c817e08c3d44`
  - ファイル: `nodes.py` を `comfy_nodes.py` として、`comfy_api/latest/_ui.py` を `comfy_ui.py` として保存
  - ライセンス: GPL-3.0
- AUTOMATIC1111 stable-diffusion-webui v1.10.1
  - コミット: `82a973c04367123ae98bd9abdf80d9eda9b910e2`
  - ファイル: `modules/images.py` を `a1111_images.py` として保存
  - ライセンス: AGPL-3.0

上流のソースは、リポジトリの外の一時ディレクトリにダウンロードします。拡張にもこのリポジトリにもコピーしません。

## 作り直し方

```bash
REF="$(mktemp -d)" && cd "$REF"   # any empty directory outside the repository
N=https://raw.githubusercontent.com/NovelAI/novelai-image-metadata/3428907ac7183d7e36d7cc39e8f46f6f35ce99c1
C=https://raw.githubusercontent.com/Comfy-Org/ComfyUI/d07dff4565ea9804277fff8cdfa0c817e08c3d44
A=https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui/82a973c04367123ae98bd9abdf80d9eda9b910e2
curl -fsSLO $N/nai_sig.py -fsSLO $N/nai_meta.py -fsSLO $N/nai_meta_writer.py
curl -fsSL $C/nodes.py -o comfy_nodes.py && curl -fsSL $C/comfy_api/latest/_ui.py -o comfy_ui.py
curl -fsSL $A/modules/images.py -o a1111_images.py
python3 -m venv venv && venv/bin/pip install pillow numpy pynacl pyyaml piexif
cd -  # back to the repository
"$REF/venv/bin/python" scripts/reference-fixtures.py --source-dir "$REF"
npm test && npm run test:extension
```

このスクリプトで、すべてのfixtureを作り直せます。

- 2026-11-19（Pillow 13.0.0、NumPy 2.5.5、piexif 1.1.3）には、以前からある6個のファイルがバイト単位で同じものになりました。
- JavaScriptのテストは、コミット済みのファイルを使い、Pythonなしでオフラインで動きます。
