# 検証状況

2026-11-22（日本時間）時点の状況です。

- 実装と合成データでのテスト: PASS。
- 実際のpixivでの受け入れ確認: まだです。pixivのページの中でのホバーとMetadataは NOT VERIFIED です。
- Service Workerの原寸取得（pixivのReferer付き、Cookieなし）は、2026-11-22に実際のi.pximg.netで200を返しました。

## 自動テスト

| コマンド | 結果 | 範囲 |
|---|---|---|
| `npm run typecheck` | PASS | WXTの準備と、TypeScriptのstrictでのチェック（src、entrypoints、tests、scripts） |
| `npm test` | PASS（15ファイル / 412件） | 下の注を参照 |
| `npm run build` | PASS | Chrome MV3。background、コンテンツスクリプト、検査ページ（`inspector.html`）、アイコン |
| `npm run build:edge` | PASS | Edge MV3。サイズはChromeと同じ。ビルドしただけで、実際のEdgeでは動かしていない |
| `npm run check:manifest` | PASS | Chrome / Edgeとも、権限は `declarativeNetRequestWithHostAccess` だけ。ホストはpixivとpximgだけ。トップフレーム・isolatedのコンテンツスクリプトがちょうど1つ |
| `npm run test:browser` | PASS（12件） | テスト用アダプタ、合成ページと合成HTTP、Chromium 156 |
| `npm run test:extension` | PASS（18件） | 本番ビルドのMV3（closed root、runtime messaging、Service Worker、検査ページ）を使い捨てのプロファイルで実行。通信はすべて合成（[証跡](evidence/mv3-synthetic-2026-11-22.json)） |
| `npm audit` | 脆弱性0件 | devDependenciesのみ |
| `git diff --check` | PASS | |
| GitHub Actions CI | PASS | 下の注を参照 |

注:

- `npm test` の範囲:
  - 解析処理と、上流で確かめた参照fixture 12個。
  - URLと認可、Service Worker、Refererのルール。
  - DOMでの競合、page store、キャッシュ、ホイール、表示、検査ページ。
  - マニフェストのポリシー、ホバー時の通信量のベンチマーク、静的なセキュリティのガード、悪意のある入力。
  - 2026-11-19の監査より前の191件は、すべて残しています。
- GitHub Actions CI:
  - 2026-11-19から `main` で通り続けています（最初の実行は[44462959593](https://github.com/marc2825/Pixiv-Metatan/actions/runs/44462959593)）。
  - PR #8（実行 44846975048）からは、5つのジョブがあります: Node 22と24での検証、`npm audit`、gitleaks、Playwright。
  - どのPRも、マージの前にCIで確認しています。

参照fixture（`scripts/reference-fixtures.py`）は、バージョンを固定しハッシュを確かめた上流のコードで作り直しました。

- 読み戻しの確認に通ったもの:
  - NovelAI公式のStealthの書き込み・読み取り処理。
  - ComfyUIの `SaveImage` と `_create_webp_metadata`。
  - AUTOMATIC1111 v1.10.1の `save_image_with_geninfo` / `read_info_from_image`。
- 以前からある6個は、バイト単位で同じものが再現できました。

## 実際のpixiv（2026-11-19、2026-11-22）

| 確認したこと | 結果 | 補足 |
|---|---|---|
| ページの取得（自動化したヘッドレスChromium 156） | FAIL（403） | CloudflareのManaged Challenge（`cf-mitigated: challenge`、"Just a moment..."）。突破も回避もしていない（[証跡](evidence/live-connectivity-2026-11-19.json)） |
| ページの取得（通常のHTTPクライアント） | PASS（200） | Cookieなし |
| pages API（通常のHTTP、公開作品1件） | PASS（200、JSON） | URLの形（`thumb_mini`、`small`、`regular`、`original`）が検証処理と一致 |
| 原寸（Cookieなし、Refererなし。2026-11-21までのService Workerの要求と同じ） | FAIL（403） | 縮小画像も403（[証跡](evidence/live-layers-2026-11-19.json)） |
| 原寸（Cookieなし、`Referer: https://www.pixiv.net/` あり。通常のHTTP） | PASS（200、image/jpeg） | 2026-11-22、Refererを付ける方針に決めた後（issue #9）。レスポンスに `Access-Control-Allow-Origin` はない（[証跡](evidence/live-referer-2026-11-22.json)） |
| 本番ビルドのService Workerからの取得（セッションルールあり、Chromium 156、実際のi.pximg.net） | PASS（200、image/jpeg） | 製品と同じ取得の設定。セッションルールは起動時に登録 |
| 同じ原寸を通常のタブの `<img>` で読む（ルールの範囲の確認） | PASS（期待どおり読み込みに失敗） | ルールはページからの要求を変えない |
| 実際のpixivのタブの中での拡張（一覧のDOM、プレビューの `<img>`、Metadataのクリック） | NOT RUN | 自動化ではページの段階で止められる。[手動での確認](MANUAL_TESTS.md)が必要（issue #11） |
| ログイン時、年齢制限のある作品 | NOT RUN | 認証情報は持ち込んでいない |
| 実際のEdge、Chrome / Edge 120、高DPI、長時間の使用 | NOT RUN | |
| 実際の生成画像でのStealth / V4 / EXIF、pixivに投稿した後に残るか | NOT RUN | 上流で確かめた合成fixtureだけ。手順はMANUAL_TESTSにある（issue #12） |
| NovelAIの署名の検証 | 未実装 | verified / invalidは表示しない |

live-connectivityのファイルには、測定したときのビルドの成果物のハッシュが記録されています。最終的なビルドのハッシュは、合成の証跡ファイルにあります。

## ホバー時の通信量（合成ベンチマーク、issue #14）

`tests/pages-traffic.test.ts` は、偽のタイマーと偽のpages APIを使って、実際のホバーのUIを動かします。

- pages APIの応答は、特に書いていなければ400ミリ秒かかります。`fetch` と同じく中止に応じます。
- 「最後」は、最後のカードにカーソルを合わせてから、そのページ一覧が出るまでの時間です。
- 変更後の値は、テストで完全に一致することを確かめています。

| 場面 | 要求数（前 → 後） | 途中で中止（前 → 後） | 最後（前 → 後） |
|---|---|---|---|
| 10枚を100msずつ通り過ぎる | 1 → 1 | 0 → 0 | 650 → 650 ms |
| 10枚を300msずつなぞる | 10 → 2 | 9 → 0 | 650 → 800 ms |
| 離れて（プレビューが閉じて）同じカードに戻る | 2 → 1 | 1 → 0 | 650 → 250 ms |
| A、B、Aに戻る | 3 → 2 | 1 → 0 | 650 → 250 ms |
| 遅いAPI（1500ms）で5枚なぞる | 5 → 2 | 4 → 0 | 1750 → 1900 ms |
| 最初に429、その後5枚なぞる | 1 → 1 | 0 → 0 | 表示なし（待機中） |

代わりに、なぞっているときだけ、最後のカードのページ一覧が150ミリ秒遅れます（サムネイルはどちらでもすぐ出ます）。実際のpixivでの通信量は NOT MEASURED です（手動での確認、MANUAL_TESTSの項目1）。

## 自動テストで確かめていること

- PNG:
  - 構造、CRC、順序。
  - tEXt / zTXt / iTXt、Latin-1 / UTF-8（BOMは残す）。
  - 重複、`__proto__` のようなキー、圧縮爆弾。
  - サイズ、画素数、チャンク、JSONの上限、取り消し。
- Stealth形式:
  - 読み取り: PNGの5種類のフィルタすべて、背の低い画像での複数列にまたがる目印、グレー+アルファ。
  - 早めの終了: 120行目より後の破損は読まない。
  - 対応しない形と検出だけするもの: 対応していない画像の形、`stealth_pnginfo` の検出。
  - 異常な埋め込み: 途中で切れたもの、大きすぎるもの、不正なgzip、gzip爆弾、JSONでないもの。
  - テキストとStealthが食い違うときの注記。
- EXIF:
  - MM / IIのUTF-16、ASCII / 未定義のUserComment。
  - ComfyUIのタグは、決められたIFD0の範囲にあるときだけ認める。
  - 壊れたJPEG / WebP / TIFFの構造、オフセット、IFDの件数。
  - 実行できそうに見えるテキストも、ただのデータとして扱う。
- V4 / V4.5のキャプション:
  - キャラクターごとのプロンプト、ネガティブ、位置。
  - 形式が合わないときの注記、上限。
- pixiv:
  - 実測したURLの形、ページの順序。
  - 検査できないページを番号を変えずに残す。
  - 他の作品の原寸や、作品・ページが合わない原寸を断る。
  - `error:true` と4xxのJSONのメッセージを無害化する。
  - 429 / タイムアウト / HTTPの分類。
- サムネイルの検出:
  - 入れ子の対象、複数の画像、カーソルを合わせた画像の優先、`currentSrc`。
  - 遅延読み込みの仮画像、使い回されるカード、画像の上にリンクが重なったカード。
  - リンクの外は推測しない、他人の作者名を借りない、上限。
- Service Worker:
  - 取得の前後での送信元 / フレーム / タブ / 文脈の確認。
  - 作品IDに結び付く依頼とURLに結び付く依頼。
  - `Retry-After` 付きの構造化した失敗、全タブで1枠、取り消し、タイムアウト。
  - MIMEと先頭バイト、読み込み中の上限。
- UI:
  - 250ms / 200msのタイミング、ホイール、キー操作、Escの伝わり方、フォーカスの保持。
  - タブ単位の待機、検査できないページ、`srcset`。
  - 共有のticker 1本、ホスト要素の付け直し、SPA / BFCache。
  - 手元のファイルを作品に結び付けない、テキストだけの表示、押したときだけのコピー。

テストの期待値を変えたのは、意図して動作を変えたときだけです。

- 変えたところ:
  - JPEGを解析するようになった。
  - 表示の文言が新しくなった。
  - Refererを付けると決めた後の403の説明。
  - ホバーで素早く切り替えるテストでの、要求のタイミング（#14）。
- どの変更でも元の保証は残しており、削ったテストはありません。

## 環境

- Linux x64（WSL2）、Node 24.21.0、npm 11.19.0、Chromium 156.0.8078.4。
- 2026-11-19のDependabotの更新（TypeScript 7.0.2、jsdom 31.0.1、Playwright 1.65.1、Vite 8.3.8、Vitest 5.1.0、WXT 0.21.5）の後に、すべて実行し直して通りました。
  - 内訳: 型チェック、Vitest 279件、両方のビルド、マニフェストのガード、ブラウザのテスト12件、本番MV3のテスト17件。
  - わざとstrictに違反するコードを書いたファイルで試したところ、TypeScript 7.0.2の診断は5.9.3と同じでした。
- Chromiumに足りないシステムのライブラリ（NSS、ALSA）は、このときだけ一時ディレクトリに展開しました。OSにもリポジトリにも入れていません。ふつうの環境では `npx playwright install --with-deps chromium` を使ってください。
- 一時的なブラウザのプロファイルは毎回消しており、既存のユーザーのプロファイルは使っていません。

## 公開前の監査（2026-11-21）

| 範囲 | 方法 | 結果 |
|---|---|---|
| すべてのコミットと参照（GitHubのPRの参照を含む、19コミット） | gitleaks 8.30.1（`git --log-opts=--all`、値は伏せる） | 検出なし |
| これまでコミットされたすべてのblob（223個。削除したファイルとバイナリを含む） | 独自のパターン（下の注を参照） | 認証情報なし。以前の `docs/TEST_STATUS.md`（今は置き換え済み）に、ローカルのホームのパスと一時ディレクトリが書かれていた。害はないので、履歴は書き換えていない |
| 履歴にある画像のメタデータ（スクリーンショット、アイコン、fixture） | PNGのテキスト、EXIF、WebPのチャンクを読み出す | 合成したテストの値だけ。スクリーンショットにメタデータはない |
| コミットの作者 | `git log --all` | メンテナーのメールアドレス（公開してよいと判断済み）と、GitHubのnoreplyアドレス |
| GitHub Actionsのログ（27回）と成果物（15個） | ダウンロードしてスキャン | GitHubが伏せたジョブのトークン（`***`）とランナーのパスだけ。Playwrightのレポートをそのまま上げた成果物が1つあり、コミットの作者のメールアドレスが入っていたが問題はない。今は伏せ字にした証跡だけを上げている |
| PRの本文とコメント（#1〜#7） | APIで書き出してパターンでスキャン | Dependabotのリリースノートとメンテナーのコメントだけ |
| 今追跡しているファイル | 同じパターンと、`.gitignore` に当たるのに追跡されているファイルの確認 | ローカルのパス、認証情報、個人的なデータなし。`.gitignore` に当たる追跡ファイルなし |
| 依存のライセンス | `package-lock.json` のlicenseの欄と、バンドルの中身の確認 | 開発用のツールは緩いライセンス（MPL-2.0の `lightningcss` はビルド時だけ）。バンドルには、このプロジェクトのコードとWXTのランタイム（MIT）だけ |

注: blobのスキャンに使った独自のパターンは次のとおりです。

- 秘密鍵。
- GitHub / AWS / Slack / Google / npm / JWTのトークン。
- Cookieや認証のヘッダー、pixivのセッションの名前、環境変数の秘密情報。
- ホームのパス、プライベートIP、ホスト名。
- 実際のpximgのURL、作品ID。

## 公開の判定

2026-11-22時点。

| 対象 | 判定 | 理由 |
|---|---|---|
| GitHubでのソースの公開 | GO（2026-11-22に公開済み） | 下の注を参照 |
| GitHub Releasesでの配布 | NO-GO | 下の注を参照 |
| Chrome ウェブストア | NO-GO | 下の注を参照 |

注:

- GitHubでのソースの公開:
  - 認証情報の漏れはありません（2026-11-21に、全履歴、CIのログ、成果物、PRの本文を監査）。
  - ライセンス、第三者の表記、セキュリティの方針、CIがそろっています。
  - 公開前の整備（PR #8）はマージ済みです。
  - 公開した直後に、非公開の脆弱性報告、Secret scanning、Push protectionを有効にしました（[RELEASE_CHECKLIST](RELEASE_CHECKLIST.md#githubでのソースの公開)）。
- GitHub Releasesでの配布:
  - まだ確かめていないこと: 実際のpixivのページでのホバー、一覧の検出、Metadataの操作（#11）。
  - 原寸の取得の経路は、Service Workerからの取得で200を確認済みです。
  - 手動の受け入れ確認と実際のEdgeでの確認が済んだら、検証した範囲を書いたプレリリースとして判定し直します。
- Chrome ウェブストア:
  - Releasesの条件に加えて、次の確認が済んでいません。
    - プライバシーポリシーのURL。
    - ストア用の素材。
    - 名前（第三者の商標）。
    - pixivの規約（Refererを付けることを含む）。
