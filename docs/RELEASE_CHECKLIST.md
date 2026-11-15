# Public release checklist

2026-11-15: **NO-GO**. Production MV3 tests pass against synthetic responses; real pixiv document access returned 403, so live artwork acceptance remains open.

- [x] Locked dependencies; Chrome and Edge MV3 builds.
- [x] Typecheck, unit/integration tests and builds PASS (see TEST_STATUS).
- [x] Synthetic Chrome UI tests; no real pixiv requests or installed extension profile.
- [x] Production MV3 installed into fresh disposable Chrome for Testing profiles; 17 tests pass with intercepted synthetic responses. No existing user profile used.
- [x] Ordinary PNG extraction cross-checked with pinned NovelAI local reader and ComfyUI SaveImage synthetic fixtures. Nested Comment handling fixed.
- [ ] Actual Chrome/Edge extension verification on owner-controlled artwork, including minimum supported browser version.
- [x] PNG tEXt/zTXt/iTXt, malformed data, bounded inflate, CRC and signature-claim handling tests.
- [ ] Gate 2 Stealth/character captions/JPEG/WebP/signatures, or an explicitly scoped public release that omits them.
- [x] Source and generated manifests inspected: only pixiv/pximg hosts; no extra API permissions, telemetry or broad hosts.
- [x] Synthetic access failures, streaming limits, malicious text, JSON bounds and cancellation tests.
- [ ] Live pximg fetch/fallback status and undocumented pixiv API behavior recorded.
- [x] Real pixiv document-level 403 recorded with build hashes and zero original requests; no access workaround attempted.
- [x] README, SECURITY and local privacy statement match implementation; synthetic screenshot available.
- [ ] Public reporting channel, privacy URL, third-party license/dependency vulnerability review and store icon/assets prepared.
- [ ] Pixiv and Chrome Web Store policies reviewed for the shipped UX.
- [x] No third-party artwork, R18 images, image uploads, scraping, credential handling or bypass mechanisms introduced.
- [ ] Explicit approval for any future push / PR / publishing / installation outside this workspace.
