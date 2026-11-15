# Implementation milestones

更新: 2026-11-15。今回のhover改善は、ユーザーの明示依頼により従来Gate 1のUX・認可範囲を拡張する。Gate 2の解析機能を前倒しするものではない。

| Phase | 実装・合成試験 | 実pixiv受入 |
|---|---|---|
| 1: 403調査と経路分離 | API/原寸の失敗層を区別。縮小表示と原寸解析を分離。401/403/429、fallback、cooldown | document 403。API/原寸の原因は未特定 |
| 2: hover | イベント委譲、250ms遅延、移動猶予、配置、SPA、focus/Escape、通常表示用画像 | NOT RUN |
| 3: 複数枚 | API順序、wheel閾値/ジェスチャ、ボタン/キー、ページ対応 | NOT RUN |
| 4: メタデータ | 明示解析、コンパクト表示/コピー、ページ別LRU、ローカル読込、取消 | NOT RUN |
| 5: 品質 | 回帰・URL/送信元/完全なタブURL検証、負荷制限、文書更新 | 実Chrome/Edge・ログイン/公開範囲確認待ち |

## 次の受入

- [ ] 正規に閲覧できる接続環境・自作テスト作品で全対象一覧の実DOMを確認。
- [ ] APIの原寸/縮小URL、ページ順、通常原寸表示とWorker取得のstatus/MIMEを別々に記録。
- [ ] ログイン/公開範囲、Chrome/Edge、最小120、SPA/BFCache/コピー/長時間メモリを確認。
- [ ] [MANUAL_TESTS.md](MANUAL_TESTS.md)の結果からリリースGO/NO-GOを判断。

## Gate 2 — deferred

Stealth、V4/V5キャラクターPrompt、JPEG/WebP EXIF、公式互換の署名検証。通常PNG reader/writerの人工fixtureは維持するが、実生成や正当な署名の証明ではない。[NOVELAI_RESEARCH.md](NOVELAI_RESEARCH.md)

## 公開 — deferred

多言語化、公開素材、脆弱性/ライセンス監査、公開プライバシーURL、ストア/pixivポリシー確認は未完了。push・公開・既存ユーザープロファイルへのインストールは明示依頼なしに行わない。模擬HTTP 200を実pximg成功と数えず、[TEST_STATUS.md](TEST_STATUS.md)でPASS/FAIL/NOT RUNを区別する。
