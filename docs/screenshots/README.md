# スクリーンショット

どれも `npm run test:browser` で、合成ページから撮ったものです。ページは自分で書いたHTMLで、画像はテストが返す1×1の黒いPNGです。実際のpixivのDOMや他の人の画像は写っておらず、実際のpixivで動いたことを示すものでもありません。

- `hover-result.png`（1100×850）: 複数枚の作品のプレビューで、2ページ目の「Metadata」を押したところ。NovelAI風の合成テキストを読んでいます。
- `hover-light.png`、`hover-dark.png`（360×640）: 画面の端近くで開いた1枚の作品のプレビュー。ライトとダーク。
- `synthetic-dark-mobile.png`（360×640）: 作品ページのパネルに結果を出したところ。ダーク。

2026-11-19にUIを新しくしたあとで撮り直しました。

テスト用のアダプタは、アクセシビリティのロケーターを使うためにShadow Rootをopenにしています。本番のビルドはclosedで、そちらは `npm run test:extension` で確かめています。
