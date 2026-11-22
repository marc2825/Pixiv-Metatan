# Implementation status and backlog

更新: 2026-11-22。完了済みの変更は[CHANGELOG.md](../CHANGELOG.md)、検証状況は[TEST_STATUS.md](TEST_STATUS.md)、公開手順は[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)を参照してください。

## 現在地

| 領域 | 実装・合成試験 | 実pixiv |
|---|---|---|
| ホバー・複数枚・キーボード・通信量の抑制（#14） | 完了 | NOT VERIFIED（自動ブラウザはCloudflareの確認画面で停止。#11） |
| pages API | 完了（形状は実測と一致） | HTTP層で200 |
| 原寸の明示取得（#9: 拡張自身の要求だけにpixivのReferer） | 完了 | Workerからの取得で200（2026-11-22）。実ページ上の操作は未確認（#11） |
| ローカルファイル検査（パネル内・独立ページ #15） | 完了 | 端末内処理のため実サイト非依存 |
| PNGテキスト / Stealth（行上限 #10） / V4キャラクター / JPEG・WebP EXIF（#13） | 完了（参照fixtureで照合） | 実際の生成画像・投稿後の残存は未照合（#12） |
| NovelAI電子署名の検証 | 未実装 | — |

## 未解決のGitHub Issue（人の作業が必要）

- **#11 実pixivの一覧・作品ページでの手動受入**: [MANUAL_TESTS.md](MANUAL_TESTS.md)の1〜10を、ログアウト・ログインの両方で記録します。検出されないカードは、同ファイルのスニペットで合成fixtureにして`tests/thumbnail.test.ts`へ追加します。実Edge・最小対応版120もここで確認します。
- **#12 pixiv投稿後のメタデータ残存性**: 自分が権利を持つ画像で、[MANUAL_TESTS.md](MANUAL_TESTS.md)の手順と表に従って測ります。結果により、READMEの説明と機能の優先順位を見直します。

解決済み: #9 #10 #13 #14 #15 #16 #17（2026-11-22のPR）。

## Issue未作成のバックログ

必要になったらIssueへ転記してください（リポジトリ外への作成はしていません）。

1. **NovelAI電子署名の検証**（`feature`, `needs-test-vector`）: 公式`nai_sig.py`は、`signed_hash`を除いたCommentのPython `json.dumps`の出力と画素バイト列（RGB、またはアルファLSBを消したRGBA）を連結し、組み込みの公開鍵でEd25519検証します。次が必要です。
   - Pillowと同一の画素バイト列の復元
   - `json.dumps`とバイト単位で一致するシリアライズ
   - Ed25519の検証手段
   - 公開鍵の出所の記録
   - **正当な署名付き画像の正例**と、改変・偽装の負例

   正例がない間は`verified`を表示しません。
2. **Stealthの対応形式の拡大**（`feature`）: 16-bit RGBA、Adam7インターレース、パレット+tRNS、グレー+tRNS。Pillowの`convert('RGBA')`と同じアルファ値になることを、公式readerとの比較fixtureで示します。
3. **XMPの読み取り**（`feature`, `evaluate`）: JPEG APP1、PNG iTXt `XML:com.adobe.xmp`、WebP `XMP `。生成ツールがXMPに書く実例（一次資料）を先に確認します。外部実体は解決しません。
4. **英語UI**（`i18n`）: `_locales`と`browser.i18n`で文字列を外部化します。判定語彙の意味は変えません。
5. **429待機のWorker再起動耐性**（`ops`, `decision-needed`）: 現状はタブ側でも待機を保持するため、同じタブからは早期の再取得をしません。別タブからは可能です。`storage.session`を使うには`storage`権限の追加が必要です。
6. **CIの`browser`ジョブの必須化**（`ci`）: GitHub-hosted runnerでの成功が続いたら、ルールセットの必須チェックに加えます。

## 実施しないこと

拡張自身の原寸取得以外へのReferer付与、Origin・その他のヘッダーの変更、CORS応答の書き換え、ページ文脈での原寸バイト取得、Cookie移植、外部proxy、自動再試行、一括ダウンロード、一覧の巡回・先読み。push・公開・リリース・既存プロファイルへのインストールは、明示的な依頼があるまで行いません。
