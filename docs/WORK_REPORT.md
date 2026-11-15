# 作業報告 — 2026-11-15

ホバー表示と明示メタデータ解析を実装した。実pixiv受入は未完了、原寸403の原因は未特定。[全検証状態](TEST_STATUS.md)

## 調査結果と設計変更

従来は作品ページの固定パネル→一覧取得→select→Inspectだった。原寸はWorkerの`credentials: omit` / `no-referrer`、APIはpixivの同一オリジンセッションを使っていた。APIは`pixiv-pages-http-*`、原寸は`http-*`なので、依頼の`http-403`は従来コード上では原寸取得層を示す。ただし、この環境では通常のdocument接続自体が403になり、同じ原寸403を実サイトで再現したわけではない。

通常画像表示とバイト列取得を分離した。APIの縮小画像をimg要素で表示し、原寸取得はMetadataクリック時だけ。Referer・Cookieの偽装やproxyは導入していない。403の表示には失敗層と不確実性を明記し、縮小表示・ローカル読込を残す。429はRetry-After/最低60秒のcooldownを尊重する。

今回の明示依頼に合わせ、作品ページ限定だった認可を拡張した。自拡張・pixiv top frame・tab ID・操作時の完全な現在URLを取得前後に検証し、URLの作品/ページ整合性と単一実行枠を維持した。旧コンテキストなし要求は作品ページ一致を要求する。page postMessageや任意fetchの橋はない。

## 実装した機能

- イベント委譲の250ms hover/focus、200ms離脱猶予、プレビューへ移動、Escape/フォーカス復帰、画面端・resize/scroll・SPA対応。既存リンク遷移を維持。
- APIのページ順に、wheel・ボタン・左右キーで切替。閾値/クールダウンとジェスチャ制御。単一画像とプレビュー外のwheelを抑制しない。
- キーボードは作品リンクのフォーカス→下矢印→画像領域→TabでMetadataへ。Prompt/RAW内のキー操作を妨げない。
- Metadataは現在ページの原寸1件だけ。既存PNGパーサー、状態区別、取消、ローカル読込を共用。
- ページ一覧24件/推定2 MiB、解析結果8件/推定8 MiB、最長2分のタブ内LRU。SPA/BFCache/破棄で消去。元バイト列・Object URLなし。
- Prompt/Negative、コンパクトな設定一覧、グラフ/RAWの折り畳み、Prompt/JSONコピー。ローカル結果は作品一致を仮定せず別表示。

## 主な変更ファイル

| 責務 | ファイル |
|---|---|
| hover UI・操作 | `src/ui/preview.ts`, `src/ui/preview-controls.ts` |
| 既存UI・表示・ファイル読込 | `src/ui/app.ts`, `src/ui/result.ts`, `src/ui/local-file.ts` |
| pixiv検証・API・DOM | `src/pixiv/artworks.ts`, `src/pixiv/thumbnail.ts`, `src/pixiv/page-store.ts` |
| Worker境界・失敗説明 | `src/network/inspector.ts`, `src/network/failures.ts` |
| メモリ制限 | `src/cache.ts` |
| 回帰試験 | `tests/hover.test.ts`, `tests/preview-controls.test.ts`, `tests/network.test.ts`, `tests/pixiv.test.ts`, `tests/browser/hover.spec.ts`, `tests/extension/hover.spec.ts` と既存fixture/driver |
| 仕様・手順・証跡 | `README.md`, `AGENTS.md`, `SECURITY.md`, `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/PRIVACY.md`, `docs/MANUAL_TESTS.md`, `docs/TEST_STATUS.md`, `docs/evidence/` |

解析エンジン・独立fixture・署名状態の意味・PNGの安全上限は変更していない。既存141テストは残し、旧ブラウザ試験の結果locatorsを新UIと区別するため完全一致に変更した。既存DOM試験では直列化されたAPIの開始を待ってから遷移/破棄し、元の取消・古い一覧破棄の検証を残した。依存関係・lockfile・MV3権限の追加なし。

## 使い方・検証

[README](../README.md)にビルド・読み込み・操作を記載。ホバー→必要ならページ切替→Metadata。失敗時は表示可能なプレビューを続け、正規保存した原寸をファイル選択する。

成功したコマンド・テスト数、実サイトのFAILとNOT RUNは[TEST_STATUS.md](TEST_STATUS.md)と状態だけの証跡を参照。実Edge用ビルドは実Edge動作確認を意味しない。第三者の画像、Prompt、認証情報を保存していない。

## 残る制限と次の作業

実際のpixiv一覧DOM、ログイン/公開範囲、API・pximgのHTTP、通常原寸表示との比較、Chrome/Edgeの実機受入が最優先。未文書化APIやURL形状が変わると、厳格な検証により表示/解析を拒否する場合がある。推測URLや制限回避では対応しない。

Stealth、V4/V5キャラクターPrompt、暗号学的署名、JPEG/WebP EXIFは未実装のまま。PNG画素も展開しない。公開審査・ライセンス/脆弱性監査・公開素材は別作業。変更はローカル作業ツリーに残し、push・公開・既存ユーザープロファイルへのインストールは行っていない。
