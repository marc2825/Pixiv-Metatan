# Changelog

All notable changes. Dates are JST. The project is unreleased; the version stays 0.1.0 until the first release.

## [Unreleased]

### Issues #9–#17 — 2026-11-22
- #9 Original Metadata on pixiv: by maintainer decision (following PixivBatchDownloader's approach), the worker's own original request now carries `Referer: https://www.pixiv.net/` via one declarativeNetRequest session rule, scoped to this extension, no tab, GET and `i.pximg.net/img-original/`. No CORS rewriting, no cookies, and pages or other sites are untouched. New permission `declarativeNetRequestWithHostAccess`. Live: 403 without and 200 with the Referer; the production worker fetch returns 200 in Chromium 156.
- #10 Stealth no longer allocates row buffers for extreme aspect ratios: rows above 1 MiB (`MAX_STEALTH_ROW_BYTES`, 262,144 RGBA px) are checked before allocation and reported as Stealth `not-checked`, while PNG text is still parsed. A synthetic 40,000,000×1 IHDR is covered by a regression test.
- #13 EXIF: values are validated only for the tags actually read, so a huge or broken unrelated tag (e.g. MakerNote) no longer makes the whole extraction fail. IFD structure checks and strict checks on target tags are unchanged. Duplicated target tags use the first value, with a note. TIFF type 13 (IFD) pointers are now followed.
- #16 Manifest guard: the policy is now a tested pure function (`scripts/manifest-policy.ts`) with a TypeScript CLI. It requires exactly one top-frame, isolated, `document_idle` pixiv content script with one JS file, a single service-worker background and no popup action. It still rejects extra permissions/hosts and exposure keys (static DNR rulesets, web-accessible resources, external messaging, CSP, options/side panels). 25 synthetic manifests are covered.

### Pre-publication audit — 2026-11-21
- Audited the full history (all commits, GitHub PR refs, deleted files, binaries and image metadata), CI logs and artifacts, and PR text with gitleaks and a custom scan. No credentials found; historical local paths are harmless and history was not rewritten.
- Added `THIRD_PARTY_NOTICES.md` (bundled WXT runtime license; how NovelAI, ComfyUI and AUTOMATIC1111 code was referenced or run without copying; trademarks).
- SECURITY.md: interim reporting route until private vulnerability reporting is enabled (public repositories only), and the automated safeguards.
- CI: actions pinned by commit SHA; new `npm audit --audit-level=high` and gitleaks jobs; uploads only sanitized evidence instead of the raw Playwright report.
- Tests: static security guards (sinks, storage/cookie/network APIs, hosts, fetch policy, messaging) and adversarial tests (URL canonicalisation, message prototype pollution, spoofed contexts, hostile DOM labels, ReDoS-style input). Vitest 279 → 355.
- `.gitignore`: secrets and signing keys, Playwright auth/trace/storage state, HAR, browser profiles, local Python environments.
- README: contribution/security section, trademark disclaimer; reference-fixture instructions use a temporary directory instead of a fixed path.

### Maintenance — 2026-11-19
- First GitHub Actions run green on Node 22/24, including the Playwright job.
- Merged Dependabot updates: actions/checkout, setup-node and upload-artifact v7 (clears the Node.js 20 deprecation warning); TypeScript 7.0.2 (same diagnostics as 5.9.3 on a strictness probe); jsdom 31.0.1; Playwright 1.65.1, Vite 8.3.8, Vitest 5.1.0, WXT 0.21.5, @types/node 26.6.6.
- `engines.node` narrowed to `^22.22.2 || ^24.15.0 || >=26.0.0` to match jsdom 31.

## 2026-11-19 audit

### Diagnosis
- Isolated the live failure layers with measurements ([evidence](docs/evidence/live-layers-2026-11-19.json)): the headless-browser document 403 is a Cloudflare managed challenge (`cf-mitigated: challenge`). i.pximg.net rejects the worker's referer-less original requests with 403; the pages API works. Decision: keep the worker's no-credential/no-referrer fetch, do not work around it, and make the local-file path the documented route.
- `verify:live` records the challenge classification instead of a bare 403.

### Added
- NovelAI Stealth (`stealth_pngcomp`, alpha LSB) reader for 8-bit non-interlaced RGBA/grey+alpha PNGs, with early exit after the magic rows. Cross-checked with NovelAI's official writer and reader.
- NovelAI V4/V4.5 character prompts, negatives and positions (official API schema), `cfg_rescale`, and `negative_prompt` as a fallback.
- JPEG/WebP EXIF text reader: AUTOMATIC1111/Forge `UserComment`, ComfyUI WebP `prompt:`/`workflow:` tags, ImageDescription/Software/Make/Model/Artist. Cross-checked with unchanged AUTOMATIC1111 v1.10.1 and ComfyUI save/read functions.
- More A1111 settings: Clip skip, Denoising strength, Hires upscale/steps/upscaler, TI hashes, Version.
- Result fields: `stealth` state and a structured `error` (`layer`, `code`, `retryAfterMs`).
- Pages with an unrecognised original URL shape (e.g. GIF/ugoira) keep their page number and preview, but are marked non-inspectable. Previously the whole listing failed.
- pixiv `error:true` and 4xx JSON messages are shown as bounded plain text; 404/5xx/timeout explanations.
- Tab-level 429 cooldown shared by both panels (survives a service-worker restart).
- `srcset` preview using the API's small/regular derivatives.
- Thumbnail detection: prefers the hovered image, checks up to 8 images in the link, supports overlay-link cards (same artwork ID required), and takes the author from the first named user link.
- CI (typecheck, tests, Chrome/Edge builds, manifest permission guard; Playwright suites as a separate job), Dependabot, `check:manifest`, original icons, reproducible evidence export.
- Tests: 191 → 279 Vitest cases; 6 → 12 upstream-verified reference fixtures.

### Changed
- Artwork-page panel requests are bound to the artwork ID instead of the exact URL, so hash/query changes on the same artwork no longer cancel them.
- One shared 300 ms ticker (was two), plus Navigation API / visibility triggers; rAF-throttled repositioning on scroll/resize.
- If the page removes the UI host, it is re-attached instead of the extension silently disabling itself.
- Escape still closes panels, but no longer swallows the key when focus is in pixiv's own inputs. When a focused button is disabled mid-operation, focus moves to the panel instead of `<body>`.
- Result layout: status badge, problem and recovery first, prompts with inline copy, settings, provenance; signature/Stealth lines only for parsed PNGs (no "未検証" on network failures).
- Unified, token-based light/dark styles with a non-pixiv accent colour.
- iTXt text keeps a leading BOM; CRC uses an indexed loop.
- JPEG without metadata is now "no metadata" (was "unsupported"); truncated JPEG is a parse error; GIF and other formats remain unsupported.
- Exact devDependency pins; version single-sourced from `package.json`.

### Docs
- Reorganised README (Japanese + English summary), AGENTS, SECURITY (private reporting), PRIVACY, ARCHITECTURE, REQUIREMENTS, TEST_STATUS, MANUAL_TESTS; backlog rewritten as issue-ready items. Removed the development-history documents (`docs/WORK_REPORT.md`, `docs/CODEX_FIRST_PROMPT.md`) and superseded 2026-10-23 evidence; both remain in git history.

## 2026-11-15 — hover previews (commit 9c77a03)
- Hover previews from pixiv listings, multipage navigation, explicit inspection, bounded tab caches.

## 2026-10-23 — Gate 1 MVP (commits b31a0b9, 77790fb)
- PNG text inspection on artwork pages, local files, worker boundary, NovelAI wrapped Comment, production MV3 tests.
