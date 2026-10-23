# Implementation milestones and gates

更新: 2026-10-23。判定の詳細: [TEST_STATUS.md](TEST_STATUS.md)。実MV3の合成試験と実pixivでの成功を区別する。

## Gate 0 — Feasibility first

**ローカル開発環境: GO / 実pixiv: NO-GO（document 403、作品/API/原寸はNOT RUN）**

- [x] Install deps; typecheck / tests / build。クリーン環境のWXT生成依存を修正しlockfileを追加。
- [x] 実機検証の[手順・記録テンプレート](MANUAL_TESTS.md)を用意。
- [x] 開発用一時Chromeプロファイルへ実MV3を読み込み、合成応答で注入・メッセージ・worker fetchを検証。
- [x] 通常の実pixiv接続を試し、document 403を[証跡](evidence/live-connectivity-2026-10-23.json)へ記録。制限回避なし。
- [ ] Chrome/Edgeで作品ページ注入、1枚/複数枚を確認。
- [ ] 正規閲覧中の `/ajax/illust/{id}/pages` が原寸URLを返すことを確認。
- [ ] 実際のMV3 background fetchの200/403等と原因を記録。
- [x] 直接取得制限時のローカルファイルfallbackを実装し、合成403/429でテスト。実サイトでは未検証。
- [ ] 実サイト検証時のbrowser version / URL type / HTTP statusの記録。

初回は実MV3が未検証だったが、今回は実Chromeの拡張として合成試験を完了。実サイトdocumentへのアクセスが拒否されたため、それ以降の実作品受入をNOT RUNのまま残す。

## Gate 1 — Releaseable MVP (P0)

**実装・自動検証: GO / リリース: NO-GO（実機受入未実施）**

- [x] PNG tEXt/zTXt/iTXt、CRC、構造・容量制限、bounded inflation。
- [x] NovelAI通常メタ、ComfyUI RAWグラフ、A1111/Forge parameters分離。
- [x] 複数の検出根拠、自己申告と署名検証の区別。
- [x] ページ選択、fallback、safe text、RAW、キーボード、コピー、ダークモード。
- [x] Streamed fetch cap、送信元/URL/現在作品の検証、クリック時のみ通信。
- [x] 取消、単一実行枠、SPAの古い結果破棄（必要な競合対策として前倒し）。
- [x] 単体/DOM結合/合成Chromeテスト。Chrome/Edge用MV3ビルド。
- [x] 実MV3と合成応答9件、公式reader/writer由来の人工fixture6件、Comment envelope不具合の修正。
- [x] README、セキュリティ・プライバシー、合成ページのスクリーンショット。
- [ ] 実Chrome/Edge拡張と実pixivでの受入。最小対応バージョン、コピー権限も確認。

## Gate 2 — NovelAI deep parsing (P1)

**実装着手: NO-GO（Gate 1実機受入待ち）。公式実装の読取調査のみ実施。**

- [x] [公式ソース・ライセンス・互換性条件の調査](NOVELAI_RESEARCH.md)。移植・検証成功の主張なし。
- [ ] Alpha stealth PNG info / compressed stealth info。
- [ ] V4/V5共通caption・キャラクターcaption・negativeの分離。
- [ ] 画素/JSON互換の暗号学的検証と、同一画像による公式Python照合。現状は明確に未検証。
- [ ] JPEG/WebP EXIF等とmetadata strippingの説明。
- [x] 複数枚切替の取消と検査済みマーカー（Gate 1で実装）。

## Gate 3 — Publish (P2)

**NO-GO / 未着手。公開やpushは依頼されていない。**

- [ ] 完全なja/en、icon、store listing、実ブラウザの公開用画像。
- [ ] 公開プライバシーURL、第三者ライセンスの配布監査。
- [ ] 依存関係の脆弱性・ライセンス監査、全権限の実機検証。
- [ ] Chrome Web Store/pixivポリシー確認、公開時の明示承認。

## Stop/GO reporting

- ステータスはGO / NO-GO / NOT RUN、テスト結果はPASS / FAIL / NOT RUN。
- 模擬HTTP 200は実pximgの200ではない。合成UIテストは実拡張インストール試験ではない。
- 署名未実装ではverifiedを生成しない。実機の未確認項目をPASSに変更しない。
- push・PR・公開・別プロファイルへのインストールは明示依頼がない限り行わない。
