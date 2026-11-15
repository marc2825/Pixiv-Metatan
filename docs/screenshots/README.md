# Synthetic UI screenshots

- `hover-light.png`, `hover-dark.png`: 2026-11-15の合成一覧ページ、360×640、単一画像プレビュー、ライト/ダーク。画像は自作の1×1 PNG（黒）。実pixivのDOMや第三者の画像は含まない。
- `synthetic-dark-mobile.png`: 以前の作品ページ用パネルの合成試験。現在も従来パネルとして残している。

新しい画像は`npm run test:browser`のhoverレイアウト試験から生成。テスト専用アダプタではrootを開き、アクセシビリティlocatorsで操作する。本番はclosed rootで、別の`test:extension`が実際のruntime/Workerを確認する。いずれも実pixiv接続成功を示す画像ではない。
