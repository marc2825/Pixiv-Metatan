# 公開のチェックリスト

2026-11-22時点。判定の理由と証跡は[TEST_STATUS.md](TEST_STATUS.md#公開の判定)にあります。

| 公開先 | 判定 | 残っていること |
|---|---|---|
| GitHubでのソースの公開 | 公開済み | 任意の設定だけ（下を参照） |
| パッケージした開発版（GitHub Releases） | NO-GO | 実際のpixivでの受け入れ確認（#11）、実際のEdge、リリースノート |
| Chrome ウェブストア | NO-GO | Releasesの項目すべてと、下のストアの要件 |

## 済んだこと

- [x] 公開前の監査:
  - PR #8 として2026-11-21にマージしました（`3c82536`）。`main` でのCIの実行 44846975048 も通っています。
  - 中身: 全履歴の秘密情報のスキャン（認証情報なし）、`THIRD_PARTY_NOTICES.md`、SECURITY.md、`.gitignore` の強化、Actionsのコミットハッシュでの固定、`npm audit` とgitleaksのジョブ。
- [x] Issue #9、#10、#13〜#17 を解決しました（2026-11-22）。
  - 原寸取得: 拡張自身の原寸取得にだけpixivのRefererを付けるようにしました。
  - 解析: Stealth形式の1行の上限、EXIFの関係ないタグの扱い。
  - 機能: ホバー時の通信量、単独の検査ページ。
  - その他: マニフェストのポリシー、文書の同期。
- [x] 自動テスト（すべて合成データで、すべてCIで実行）:
  - 型チェック、Vitest（15ファイル / 412件）。
  - ChromeとEdgeのビルド、マニフェストのガード。
  - ブラウザのUI 12件、本番MV3 18件。
  - `npm audit`、gitleaks。
- [x] 実際の環境での確認（HTTPとService Workerの段階だけ）:
  - pages API: 200。
  - 原寸: Refererなしで403、pixivのRefererありで200。
  - 本番ビルドのService Workerからの取得: Chromium 156で200。
- [x] 依存と扱うデータ:
  - devDependenciesはlockファイルで正確なバージョンに固定しています。
  - ランタイムの依存は、バンドルに入るWXTのランタイム（MIT）だけです。
  - 第三者の作品画像、利用状況の送信、認証情報の扱いはありません。

## GitHubでのソースの公開

非公開のうちに設定したこと（2026-11-22）:

- [x] リポジトリ:
  - 名前を `marc2825/Pixiv-Metatan` に変えました（古いURLは転送されます）。
  - 説明とトピックを設定し、Projectsは切りました。
- [x] Actions:
  - 使えるのはGitHub自身のアクション（`actions/*`、`github/*`）だけです。
  - ワークフローのトークンは読み取り専用で、PRの承認もできません。
  - フォークからのPRのワークフローは切っています。
- [x] Dependabotのアラートとセキュリティ更新を有効にしました。
- [x] ルールセット「Protect main」（有効・強制）:
  - 削除とforce pushの禁止、履歴を一直線に保つ、PRを必須にする（承認は0人）。
  - 必須のチェック:
    - `Typecheck, unit tests, Chrome/Edge MV3 builds (Node 22)`
    - 同じジョブの `(Node 24)`
    - `npm audit (high and critical)`
    - `Secret scan (gitleaks, full history)`
  - 管理者がこのルールを迂回できるのは、PRをマージするときだけです。
- [x] マージ:
  - マージコミットは使えないようにしました（squashとrebaseのみ）。
  - マージしたら作業ブランチを消します。
- [x] 履歴とローカルのパスを見直しました。個人の情報は作者のメールアドレス（公開してよいと判断済み）だけで、古いローカルのパスからわかるのは公開しているユーザー名だけです。

公開したあとに行ったこと（2026-11-22）:

- [x] メンテナーがリポジトリを公開にしました。
- [x] Settings → Advanced Security（Code security）で、次を有効にしました。どれも非公開のリポジトリでは使えない設定です。
  - Private vulnerability reporting
  - Secret scanning（有効にした時点のアラートは0件）
  - Push protection
- [x] フォークからのPRのワークフローは、初めての貢献者の場合に承認が要る設定（`first_time_contributors`）になっていることを確かめました。

残っている任意の作業:

- [ ] CodeQLのdefault setupを有効にする。
- [ ] 「Require actions to be pinned to a full-length commit SHA」を有効にする。先にDependabotがそれでも動くことを確かめる。Dependabotの動的なワークフローが対象外かどうかは、GitHubの文書に書かれていない。
- [ ] Playwrightのジョブが安定して通り続けたら、必須のチェックに加える。
- [ ] 古い `synthetic-mv3-report` の成果物を消す（期限切れを待ってもよい）。

## パッケージした開発版（GitHub Releases）

- [ ] #11: 通常のChromeで、手動の受け入れ確認（[MANUAL_TESTS.md](MANUAL_TESTS.md)の1〜10）を、ログアウトとログインの両方で行う。
  - **実際のpixivのページでのMetadata** もここに含まれる。
  - 実際の環境で確かめたのは、今のところService Workerの要求の経路だけ。
- [ ] 実際のEdgeと、最低バージョン120での確認。
- [ ] リリースノート。書くこと:
  - 何が合成データでの確認で、何が実際の環境での確認か。
  - 拡張自身の原寸取得にpixivのRefererを付けること（範囲と権限）。
  - 手元のファイルで調べる方法。
  - 署名は検証していないこと。
- [ ] 公開の手順:
  - きれいなチェックアウトから `npm run zip` / `npm run zip:edge` を実行する。
  - SHA-256の値を添える。
  - タグを打って公開することについて、メンテナーがはっきり承認する。

## Chrome ウェブストア

- [ ] パッケージ版の項目すべて。
- [ ] 公開するプライバシーポリシーのURL（[PRIVACY.md](PRIVACY.md)を元にする）と、データの使い方の申告（データは集めない）。
- [ ] 審査に出す説明:
  - 目的が1つであることの説明。
  - 2つのホスト権限と `declarativeNetRequestWithHostAccess` が必要な理由（拡張自身の原寸取得にpixivのRefererを付けるため）。
- [ ] 名前と掲載文での「pixiv」の使い方と、Refererの方式を含めたpixivの規約を確認する。
- [ ] ストアのスクリーンショットは合成ページだけで作る（アイコンは `public/icon/` にある）。
- [ ] 任意: #12の結果を、掲載文で期待値を伝えるのに使う。
