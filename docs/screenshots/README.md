# Synthetic UI screenshots

All screenshots come from `npm run test:browser` on synthetic pages: our own HTML, and 1×1 black PNGs served by the test. They contain no real pixiv DOM, no third-party images, and do not show live pixiv success.

- `hover-result.png` — 1100×850, multipage hover preview after **Metadata** on page 2 (synthetic NovelAI-like text metadata).
- `hover-light.png`, `hover-dark.png` — 360×640, single-page preview near the viewport edge, light/dark.
- `synthetic-dark-mobile.png` — 360×640, artwork-page panel with a result, dark.

Updated 2026-11-19 after the UI refresh. The test adapter opens the shadow root for accessibility locators; the production build uses a closed root (covered by `npm run test:extension`).
