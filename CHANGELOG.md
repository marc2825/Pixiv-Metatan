# Changelog

All notable changes. Dates are JST. The project is unreleased; the version stays 0.1.0 until the first release.

## [Unreleased] — 2026-11-19 audit

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
