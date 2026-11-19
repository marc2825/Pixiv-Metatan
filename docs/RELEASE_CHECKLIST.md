# Release checklist

Status 2026-11-19: **source publication: conditional GO; packaged release and Chrome Web Store: NO-GO** (see the reasons in [TEST_STATUS.md](TEST_STATUS.md#公開判定)).

## Automated (done in this repository)
- [x] Locked, exact devDependencies; `npm audit`: 0 vulnerabilities; no runtime dependencies besides the bundled WXT runtime (MIT).
- [x] `npm run typecheck`, `npm test`, `npm run build`, `npm run build:edge`, `npm run check:manifest` pass.
- [x] `npm run test:browser` and `npm run test:extension` pass locally against synthetic responses.
- [x] Manifest: no API permissions; hosts `www.pixiv.net` and `i.pximg.net` only; top-frame isolated content script; icons present.
- [x] Parsers cross-checked with upstream-verified synthetic fixtures (NovelAI writer/reader, ComfyUI, AUTOMATIC1111).
- [x] No third-party artwork, R18 images, uploads, telemetry, credential handling or bypass mechanisms.
- [x] README, SECURITY and PRIVACY match the implementation.

## Before publishing the source on GitHub
- [ ] Enable GitHub private vulnerability reporting (Settings → Code security).
- [ ] Confirm the CI workflow runs green on GitHub (the `browser` job is not yet observed on hosted runners; keep it non-required until it is stable).

## Before a packaged release (GitHub Releases)
- [ ] Manual live acceptance in a normal Chrome on owner-controlled or legitimately viewable artwork ([MANUAL_TESTS.md](MANUAL_TESTS.md) items 1–8), logged out and logged in.
- [ ] Real Edge and minimum version 120.
- [ ] Release notes state plainly that **Metadata** fetching is expected to be rejected (403) and that local files are the supported route.
- [ ] Build with `npm run zip` / `npm run zip:edge` from a clean checkout; attach SHA-256 of the zips.
- [ ] Explicit maintainer approval for tagging and publishing.

## Before the Chrome Web Store
- [ ] All packaged-release items.
- [ ] Public privacy policy URL (can be based on `docs/PRIVACY.md`) and data-use disclosures (no data collected).
- [ ] Single-purpose description; justification for the two host permissions.
- [ ] Store screenshots from synthetic pages only; 128 px icon (provided in `public/icon/`).
- [ ] Review use of the third-party name "pixiv" in the extension name and listing, and pixiv's terms, for the shipped UX.
- [ ] Decide whether a listing is appropriate while the **Metadata** fetch fails on real pixiv by policy.
