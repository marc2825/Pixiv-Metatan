# Architecture

更新: 2026-11-15。追加依存・バックエンド・MV3権限の追加なし。

## UIと取得経路

```text
pixiv top-level / isolated content script / closed Shadow DOM
  ├─ app.ts: 作品ページの従来パネル、ページselect、ローカル読込
  └─ preview.ts: イベント委譲のhover/focus、フローティングパネル
       ├─ 250ms後、その作品だけの /ajax/illust/{id}/pages
       │    └─ getArtworkPages: same-origin session / redirect:error
       │         → 1 MiB / 15秒 / スキーマ / 元URL・縮小URL・ページ順の検証
       ├─ 通常の <img src=API derivative>（p0は元サムネイルも可）
       │    └─ 表示専用。originalへの代替、canvas抽出、CORS読込なし
       ├─ wheel / 前後 / 左右キー → 表示ページだけ切替、解析しない
       ├─ Metadataクリック → {type, requestId, artworkId, page, url, contextUrl}
       │    └─ runtime.sendMessage → MV3 service worker
       │         → 自拡張 / pixiv origin / frame 0 / tab ID / 完全な現在URL
       │         → 原寸URLのhost・path・作品ID・ページを検証
       │         → グローバル1枠 / credentials:omit / no-referrer / redirect:error
       │         → 15秒 / 実受信48 MiB / MIME・magic / 既存のローカル解析器
       │         → 再び現在URL照合 → JSON互換結果
       └─ ファイルの明示選択 → inspectLocalFile → 同じ解析器
```

表示と解析は異なる経路。`<img>`はページの通常のブラウザ表示条件に従う。拡張からRefererを指定せず、Cookieの読取・移植もしない。元サムネイルとAPIの縮小画像だけを表示し、解析用原寸をhoverで取得しない。APIに縮小URLがないページでは表示不可を説明し、原寸へ切り替えない。

## 信頼境界

`thumbnailFromTarget`は画像を含む正規pixiv作品リンクを対象にし、DOM由来の画像も作品ID/ページ0と厳密に照合する。タイトル/作者名は長さ制限付きのテキスト。URLをDOMやAPIから得ても信頼済みにしない。

元URLをAPIから得たという根拠はisolated content script内に置く。Workerはスキーマに加えHTTPS、正確なhost/path、作品/ページ、送信元とタブを独立検証する。`contextUrl`は操作時の完全なpixiv URLであり、取得前後の`tabs.get`と完全一致が必要。これによりランキングなどの表示作品を検査できる。`contextUrl`なしの旧要求は従来どおり現在タブの作品ID一致が必要。信頼境界の根拠をページのpostMessageや任意DOM属性で登録する機能はない。

`sender.url`はSPA以前の値を持つ場合があるため、送信元originと現在URLの検査を分離する。URL変更・タブloading/終了でもWorkerが中止する。同一タブ・requestIdだけが取消可能。全タブ共通の枠は最初のawaitより前に確保し、body/parseがsettleするまで解放しない。非同期応答は`return true`と`sendResponse`でChromeの互換性を維持する。

host permissionは`www.pixiv.net`と`i.pximg.net`のみ。`tabs`、`cookies`、`storage`、`webRequest`等の追加API権限なし。画像パスの制約は実装で強制する。

## ライフサイクル・負荷

- DOM全体の走査・MutationObserverなし。mouseover/out、focusin/outを委譲。ホバー250ms、離脱200ms。
- 300msの監視はURL確認・キャッシュ掃除・対象要素の接続確認のみ。操作ハンドラと非同期結果でもURL/世代を確認する。
- 別作品・ページ・SPA・close・BFCacheで古い作業をabortし、世代が違う結果を無視する。元リンクは書き換えない。画面外のカード・削除されたカードは閉じる。
- レイアウトは元カードのrectから左右を選び、ビューポート内へクランプ。resize/scrollで追従する。
- APIは従来パネルとhover共用のstore内で直列化し、中止済みの待機操作は取得しない。Worker原寸はグローバル1件。表示は現在ページのimg要素1つで、隣接ページは先読みしない。
- 429のAPI cooldownはタブ内、原寸cooldownはWorker内。Retry-After（秒/日付）を最長24時間・最低60秒で扱う。Worker再起動時はメモリのcooldownも失われる。
- `MemoryCache`はLRU＋2分のTTL。一覧24件/推定2 MiB、結果8件/推定8 MiB。サイズはUTF-16 JSONの保守的な概算で、ブラウザの実ヒープ上限とは異なる。上限を超える単一結果は表示だけ行う。元バイト列・Object URLは保持しない。
- キャッシュはSPA/BFCache/破棄で全消去。ローカルファイルの結果をpixivページのキャッシュへ登録しない。

## 解析と表示

`src/metadata/`はpixiv/UIから独立した既存の純粋な解析層。状態・根拠・fields・RAW・署名状態は`types.ts`を維持する。PNG構造/CRC/文字コード/重複、2 MiBの通常テキスト予算、上限付きdeflate、深さ64/50,000値のJSON制限を維持した。48 MiB/40百万画素/4096チャンク/128テキストチャンク。

PromptとNegativeはスクロール領域に表示し、設定はコンパクトな一覧。ComfyUIとRAWは開いたときだけ描画する。全てtextContent、コピーはクリック時だけ。not-presentは解析した通常テキスト内の署名不在で、Stealthや生成元の証明ではない。verified/invalidを生成する実装はない。

## 403の調査結果

旧コードも新コードも、APIはpixiv同一オリジンセッション、原寸は拡張Workerの無認証・Refererなしの取得。APIは`pixiv-pages-http-*`、原寸は`http-*`で区別し、UIも失敗層を明記する。

2026-11-15の通常接続は**document 403**で停止。API/原寸URLの正しさ、通常ブラウザで原寸を開けるか、画像配信側の403、ログイン/公開範囲/Edge差はNOT RUN。Refererが原因だと断定できる証拠はない。401/403/429では状態を保持し、表示可能な縮小画像と明示ファイル選択を提供する。

[Chrome公式: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)は、content scriptの同一オリジン制約と拡張originのhost permissionを区別している。これは実pixivのアクセス許可やサーバーが拒否する理由の証明ではない。

## テスト境界

Vitestは純粋解析・URL/認可・DOM競合・cache/wheel、`test:browser`はテスト用アダプタと合成ページ、`test:extension`は実際の本番MV3・closed root・Worker通信を合成応答で検査する。既存の解析fixtureを流用し、実画像はリポジトリに含めない。[実機検証](MANUAL_TESTS.md)と[結果](TEST_STATUS.md)を参照。
