# Codexへの最初のプロンプト

あなたはTypeScript、Chrome拡張機能Manifest V3、画像フォーマット、セキュアなフロントエンドに精通した実装エージェントです。既存リポジトリ `pixiv-ai-metadata-inspector` を読み、pixiv作品ページ内でNovelAI/ComfyUI/Stable Diffusionの画像生成メタデータを安全に閲覧できる拡張機能を作ってください。

## 最初に確認
1. `AGENTS.md`、`docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION_PLAN.md`、`README.md` をすべて読む。
2. リポジトリ全体を確認する。現在のコードはスターターであり、リリース可能な完成実装ではない。特に通常PNGの一部のテキスト解析しかできず、メタデータの検証やStealth読込が未実装である。
3. 既存の構成・仕様を尊重する。必要な改善は行ってよいが、範囲拡大は理由を説明する。

## ゴール
- Chrome/EdgeのManifest V3拡張。pixiv作品詳細ページにコンパクトなボタンを追加する。
- ユーザーのクリック後にのみ、画像一覧のうち選ばれた原寸画像を取得・解析する。正規に閲覧できる範囲のみ。
- NovelAI、ComfyUI、A1111/Forgeのメタデータを抽出、Prompt/Negative/Seed/Steps/Model/Sampler/キャラクター別Prompt等を存在する範囲で表示する。
- NovelAI Stealth PNGのアルファチャンネル情報、PNG `tEXt`/`zTXt`/`iTXt` の対応を段階的に完成させる。
- メタデータの自己申告による「推定」と、実際のNovelAI署名の「検証済」を混同しない。未実装なら明確に「未検証」。
- ファイルがJPEGに変換済み、メタデータ削除済み、pixiv元画像403/429の場合は説明し、ユーザーがローカルファイルを選択できるようにする。

## 最重要な制限
- pixivのログイン・R18制限・画像アクセス制限・レートリミットは回避しない。リファラ偽装、外部プロキシ、Cookie抽出、大量巡回、作者ページや検索結果の無断一括解析は禁止。
- 画像/プロンプトを第三者サーバーへ送信しない。解析はローカル。Host permissionsはpixiv/pximgだけ、無駄な権限やSDKは追加しない。
- 元画像URLは信頼できる現在の作品情報に基づく。Worker側でも送信元とURLを再検証する。
- セキュリティ境界において、任意のURLを取得する汎用メッセージAPIを作らない。
- 取得画像サイズ、PNGチャンク長、展開後データ量、画素数、タイムアウトを制限する。未信頼テキストを`innerHTML`で表示しない。
- ComfyUIはワークフローのUIであって生成モデルではない。記録がない情報を推定値として補完しない。
- 実画像での動作確認を行っていない場合、実機PASSと報告してはいけない。

## 作業指示（順序を守る）
Phase 0: 既存コードの型チェック、単体テスト、ビルドを実行してエラー修正。PNGパーサ等の未実装箇所を洗い出し、実際のpixivでの元画像フェッチ可否を確認できる調査手順を用意。可能ならブラウザ環境で実証（手元に環境がなければ NOT RUN と記録）。
Phase 1: P0要件 F-01〜F-10を実装・テスト。PNG tEXt/zTXt/iTXt、ComfyUI JSON、NovelAI通常メタ、A1111、エラー分岐、複数枚、SPA、取得失敗時のファイル入力を確実にする。単体テストだけでなく、Playwright等による合成DOMを使った結合テストを加える。
Phase 2: Phase 1がGOなら、NovelAI公式 `https://github.com/NovelAI/novelai-image-metadata` を参考にStealth/署名検証をブラウザ内で実装可能か評価。移植したコードのライセンスと出典を整理。署名検証は公式スクリプトと同一画像でクロスチェックすること。V4/V5のキャラクタープロンプトにも対応。
Phase 3: 主要機能が完成したら、READMEと公開前チェックリストを更新。Web Store公開やGitHub pushはしない。

## テストと報告
- `npm run typecheck`、`npm test`、`npm run build` を成功させる。
- 独立の人工PNG fixturesを用意し、tEXt/zTXt/iTXt、JSON不正、Unicode、巨大チャンク、CRC異常、Stealth有無、署名有無、JPEG/WebPを検証する。
- 重要な失敗パターン: 403/429/404、サーバー側JPEG化、pixiv SPA遷移、複数画像、手動ファイル読込、不要なネットワーク通信。
- 最終報告には、変更ファイル、実装済/未実装、PASS/FAIL/NOT RUN、既知の問題、次のGate、git statusを明記する。
- 必要なら小さなローカルコミットを作成してよいが、push・PR・公開はしない。

最初の出力は、現在のプロジェクトの短い技術評価とGate 0の実行計画にしてください。その後、可能な限りPhase 1まで実装してください。単なる計画だけで終了せず、実際にコードとテストを変更してください。
