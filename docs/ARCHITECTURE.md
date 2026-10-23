# 技術設計 / Architecture

更新: 2026-10-23。実装対象はGate 1。実MV3は合成応答で検証済み。実pixivはdocument HTTP 403で作品/API/原寸を未検証。

## 信頼境界と通信

```text
pixiv top-level tab / isolated content script
  └─ closed Shadow DOM (mountInspector)
       ├─ パネルを開く / 一覧取得のクリック
       │    └─ same-origin /ajax/illust/{id}/pages
       │       → 1 MiB/15秒、JSONスキーマ、配列順序、作品ID/ページ別URL検証
       ├─ Inspectのクリック → {type, requestId, artworkId, page, url}
       │    └─ runtime message → MV3 service worker
       │         ├─ 自拡張ID + pixiv origin + top frame + tab ID
       │         ├─ tabs.getで現在の作品ID確認（SPAでsender.urlが古い場合に対応）
       │         ├─ HTTPS i.pximg.net + img-original/img/.../{id}_p{page}.ext
       │         ├─ 1つのグローバル実行枠（tabs.getより前に確保）
       │         ├─ credentials: omit / redirect: error / no-referrer
       │         ├─ 15秒 / 実受信48 MiB / MIMEとmagicの照合
       │         └─ ローカル解析 → 現在のタブ再確認 → JSON互換の結果
       ├─ 取り消し・SPA遷移・閉じる → abort + requestId付き取消要求
       └─ 明示ファイル選択 → サイズ確認 → bounded stream → 同じ解析器
```

元URLは現在アクセスできる作品APIの応答からのみ採用し、構築しません。Workerでも作品・ページ・URLを照合します。APIから取得したという根拠はisolated content scriptの信頼境界に置きます。ウィンドウメッセージ、DOM属性、ページスクリプトから汎用fetchを呼ぶ橋は公開しません。Workerは別の作品や任意サイトのURLを取得しません。

`sender.url`はSPAの前のURLを示す場合があるため、送信元のpixivオリジンと現在のタブの作品IDを分けて確認します。pixivのhost permissionは、このタブURL確認とサイト注入に利用します。`tabs` / `cookies` / `storage` / `webRequest` / `offscreen`等の追加権限はありません。Chromeのhost permissionではパス制限が効かないため、画像のパス制限を実装内で強制します。

非同期メッセージ応答は`return true` + `sendResponse`。Promiseを返すlistenerの新しいChrome依存を避けます。Chrome/Edge 120以降を最低対象としますが、実機の最小バージョン検証は未実施です。

## スケジューリング

- 一覧はクリック時だけ。画像取得はInspectのクリック時だけ。SPA検出はURL確認のみ。
- 複数タブを含めWorker全体で画像取得・読込・解析は1件。追加要求をキューに積まず`busy`を返します。
- 取消は同じタブ・requestIdだけ。abortを要求しても、元処理のfinallyまで枠を解放しません。
- タブ移動・ロード・終了もWorker側で取消。UI側は世代番号と現在の作品IDで古い一覧・結果を破棄。
- BFCache入りでは候補・結果を破棄し、復帰後に再度クリックが必要。ホスト要素の除去・WXT無効化ではタイマーとlistenerを破棄。

## データモデル

`src/metadata/types.ts`が型の定義です。

- `status`: found / no-metadata / unsupported-format / access-denied / too-large / parse-error / cancelled / busy
- `format`: png / jpeg / webp / other
- `generator`: 既存コード互換の代表値。UIは`detected[]`と`evidence[]`を使い、混在した自己申告を保持。
- `confidence`: metadata-indicates / weak / unknown。現実装ではweakを生成しません。
- `novelaiSignature`: not-checked / not-present / verified / invalid。現実装は最後の2つを生成しません。
- `fields`: 表示用の文字列辞書。通常NovelAIの共通Prompt/Negative等とA1111設定を抽出。ComfyUIはグラフを保持し、唯一のPromptを推測しない。
- `rawTextChunks`: 重複のない通常テキストキー。`textEntries`: 元のチャンク種別・キー・値を重複込みで保持。
- `notes`: 失敗・不確実性・未対応の説明。`source`: pixiv作品/ページ/URL、または明示選択したファイル名。

NovelAIの検出にはSoftwareの自己申告を使用し、汎用のsteps/samplerや署名文字列だけを根拠にしません。公式reader互換でComment内のComment文字列を1段だけ読み、RAWは保持します。内側も同じJSON上限で検証し、不正なら値の抽出を止めます。ComfyUIはAPIノードまたはworkflow.nodesのJSON構造を確認します。ComfyUIは生成エンジンではありません。独自ノードの中身やモデルの意味は解釈しません。

## PNGとサイズ制限

- ファイル48 MiB、寸法40百万画素、全チャンク4096、テキストチャンク128。
- PNGシグネチャ、全チャンクの境界とCRC、IHDRの寸法/色形式、PLTE、IDAT連続性、IENDを確認。未知のcritical chunkは拒否。
- PNG tEXtはISO-8859-1。ブラウザの`TextDecoder('latin1')`はWindows-1252なので使用しない。
- zTXt / 圧縮iTXtはネイティブ`DecompressionStream('deflate')`で展開し、ストリームを2 MiBの共通予算で制限。圧縮状態のテキスト総量も2 MiB以下。
- iTXtは厳格なUTF-8、圧縮フラグ/方式/ヘッダーを検証。不正ならparse-error。
- 重複キーワードは判定から除外し、RAWに保持。署名の存在申告は重複時もnot-checked。
- JSONは2 MiB、深さ64、最大50,000値。RAWは失わず、不正JSONを検出根拠に使わない。
- 実受信バイトを数える可変長バッファを使用。細かいチャンクが多数届いてもチャンク配列の管理メモリが増え続けない。
- IDAT画素は展開しないため、Stealth未検査。画像として完全にデコード可能かまでは保証しない。

ローカルファイルは`.size`を読んでからstreamで読み込みます。フルサイズのarrayBufferを先に確保しません。ネットワーク応答はContent-Lengthに依存せず制限を強制し、超過・拒否時はbodyをcancelします。

## UI・プライバシー

全メタデータはtextContentで描画。JSONはデータとしてだけ扱い、HTML/Markdown/スクリプトを実行しません。RAWとComfyUIは展開時のみ描画。コピーはクリック時のみで、ブラウザが拒否した場合は手動コピーを案内します。永続保存・解析ログ・外部API・テレメトリーはありません。

## 残る境界検証

`test:browser`は従来のテスト用アダプタです。`test:extension`は生成済みの本番ビルドを一時Chromeプロファイルへ読み込み、closed Shadow DOMをDevToolsで操作します。ページ・API・原寸の応答は合成ですが、実際のcontent script隔離、runtime messaging、worker fetch、tabs.getと取消を通します。テスト用の権限やメッセージ橋を製品に加えません。

`verify:live`は通常の実サイト接続用で、作品URLと0始まりのページを指定して原寸を1回だけ検査します。認証は移植せず、画像・Prompt・RAW・URLを証跡へ保存しません。document拒否時は停止し、エラーをPASSへ変換しません。ビルドSHA-256と状態だけ記録します。Nodeの開発用コマンドであり、拡張から外部処理を呼ぶ機能ではありません。

実pixivはdocument 403のため作品を検査できていません。未文書化API、ログイン状態、原寸200/403、実EdgeとMV3の長時間寿命は[手動検証](MANUAL_TESTS.md)が必要です。[Gate 2調査](NOVELAI_RESEARCH.md)を参照。

参照: [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)、[W3C PNG 3](https://www.w3.org/TR/png-3/)。
