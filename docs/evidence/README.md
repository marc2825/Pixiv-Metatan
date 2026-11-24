# 検証の証跡

状態だけを記録した、伏せ字済みの証跡です。次のものは入っていません: 画像、プロンプト、作品IDやURL、認証情報、リクエストヘッダーの生データ、HARファイル、ローカルのパス。

| ファイル | 内容 |
|---|---|
| `live-layers-2026-11-19.json` | 実際のpixivでの、層ごとの切り分け（下の注を参照） |
| `live-referer-2026-11-22.json` | メンテナーの決定（issue #9）の後の測定（下の注を参照） |
| `live-connectivity-2026-11-19.json` | 新しいヘッドレスのプロファイルで、`npm run verify:live` をトップページに対して実行した記録（下の注を参照） |
| `mv3-synthetic-2026-11-24.json` | 今の本番MV3での実行（18件。作り直したUIと、複数の画像を扱う検査ページを含む）。通信はすべて合成で、記録の形式は下のものと同じ |
| `mv3-synthetic-2026-11-22.json` | 前回（UIを作り直す前）の本番MV3での実行（18件） |
| `mv3-synthetic-2026-11-19.json` | 本番のMV3ビルドを使い捨てのプロファイルで動かした記録（下の注を参照） |
| `live-connectivity-2026-11-15.json`、`mv3-synthetic-2026-11-15.json` | 比べるために残している前回の実行。2026-11-19のファイルで置き換え済み |

注:

- `live-layers-2026-11-19.json`:
  - ヘッドレスブラウザでのページの403は、CloudflareのManaged Challengeによるものでした。
  - 通常のHTTPでは、ページは200でした。
  - pages APIは200で、URLの形は検証処理と一致しました。
  - 原寸と縮小画像は、Refererなし（当時のService Workerの要求と同じ条件）で403でした。
  - ヘッダーの偽装はしておらず、画像にはHEADリクエストだけを使いました。
- `live-referer-2026-11-22.json`:
  - 同じ原寸が、Refererなしでは403、`Referer: https://www.pixiv.net/` ありでは200でした（Cookieなし）。
  - 本番ビルドのService Workerから、セッションルールありで取得すると、Chromium 156で200でした。
  - ページの `<img>` にはルールが効きませんでした。
  - 作品ID、URL、画像のデータは記録していません。
- `live-connectivity-2026-11-19.json`:
  - ページの403は、`cloudflare-managed-challenge` に分類されました。
  - APIと原寸は要求しておらず、仕様どおり0以外で終わります。
- `mv3-synthetic-2026-11-19.json`:
  - ページ、API、画像の応答は、すべて横取りしてこちらで作ったものです。
  - テストごとの通信の記録（種類、Service Workerかページか、ステータス、MIME、ページ）と、ビルドのSHA-256があります。
  - 実際のpixivにアクセスできたことの証拠にはなりません。

合成の記録の項目:

- `configuredStatus`: fixtureとして返す予定だったステータス。
- `status` / `mime`: ブラウザの応答のイベントから取った値。取り消したりタイムアウトしたりした要求は、`configuredStatus` があっても `status` がないことがあります。
- `outcome`: 要求が最後まで終わったか、失敗したか。

実際のサイトに対するコマンドは、失敗を成功に見せかけるために次のことをしません: ヘッダーの変更、認証情報の持ち込み、プロキシ、取り直し、ボット確認の突破。

2026-10-23の古い証跡はgitの履歴に残っています。

合成の証跡は、`npm run test:extension` の後に次のコマンドで作り直せます。

```bash
node scripts/export-synthetic-evidence.mjs docs/evidence/mv3-synthetic-YYYY-MM-DD.json
```
