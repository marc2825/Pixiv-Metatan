# AGENTS.md — pixiv AI Metadata Inspector

Rules for coding agents working in this repository. Keep changes small, tested and honest about what was verified.

## Mission
A small, privacy-first Chrome/Edge MV3 extension: user-hovered pixiv thumbnail previews, and explicit, user-initiated metadata inspection of the displayed page or a user-chosen local file. The value is pixiv integration and evidence transparency, not bulk collection.

## Read before editing
1. `docs/REQUIREMENTS.md` — scope, acceptance criteria, non-goals.
2. `docs/ARCHITECTURE.md` — trust boundary, network flow, supported metadata.
3. `docs/TEST_STATUS.md` — what is verified (PASS / FAIL / NOT RUN) and how.
4. `docs/IMPLEMENTATION_PLAN.md` — open work, written as issue-ready items.
5. `README.md` — must match implemented behavior.

## Hard invariants
- No automated crawling, list sweeping, bulk or hidden downloads, proxying, or bypassing pixiv login, age restrictions, access controls or rate limits. The only hotlink-related measure is the narrow Referer rule below.
- Original bytes are fetched **only after a click on Metadata / 元画像を検査**, one page, one active original operation globally. Hover may request that artwork's page list and display derivatives only. No speculative prefetch.
- Original URLs come from pixiv's accessible artwork data and must match `https://i.pximg.net/img-original/img/…/{id}_p{page}.{png|jpg|jpeg|webp}`. Never reconstruct URLs.
- **Original fetching stays in the service worker** with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`. i.pximg.net answers 403 without a pixiv Referer and 200 with `Referer: https://www.pixiv.net/` (measured 2026-11-19/22; cookies are not involved). By maintainer decision (2026-11-22, issue #9, following PixivBatchDownloader's approach but narrower) one declarativeNetRequest **session** rule (`src/network/referer-rule.ts`) sets that Referer only on this extension's own (initiator = extension ID, tab = none) GET of `https://i.pximg.net/img-original/`. Do not widen it: no response-header or CORS rewriting, no rules for pages, other sites or other headers, no cookies, no page-context byte fetching, proxies, retries or bulk download.
- Minimum MV3 permissions: `declarativeNetRequestWithHostAccess` only (for that rule); hosts `https://www.pixiv.net/*` and `https://i.pximg.net/*` only (`npm run check:manifest` enforces this). Never add broad hosts, cookies, tabs, storage or webRequest without an explicit, documented decision.
- Process bytes locally. No telemetry, analytics, ads or third-party processing. No persistence of images or results.
- Never render untrusted metadata with `innerHTML`, `eval`, JS URLs, markdown or remote code. Use `textContent` and bounded parsers.
- Self-reported metadata says "metadata indicates" (メタデータから推定). Only a real cryptographic verifier may produce `verified`/`invalid`; none exists yet.
- Absent, unsupported or inaccessible metadata is never evidence of human authorship.
- Treat pixiv JSON, DOM and image metadata as untrusted. Preserve page indexing; never skip or renumber pages.
- No real R18 or third-party images in the repository. Fixtures are synthetic and generated here.
- Extension messaging must never become a generic fetch proxy.

## Layout
- `entrypoints/` — content script (isolated world, closed shadow root) and MV3 service worker.
- `src/pixiv/` — URL/ID validation, pages API adapter, thumbnail detection, per-tab page store.
- `src/network/` — worker inspection boundary, failure explanations, cooldowns.
- `src/metadata/` — pure, bounded parsers (PNG text, Stealth, EXIF, JSON) and classification.
- `src/ui/` — presentational code and shared styles.
- `tests/` — Vitest (`*.test.ts`), Playwright synthetic UI (`tests/browser`) and production MV3 (`tests/extension`).

## Workflow
1. Read the specification and current code; state a short plan.
2. Add a failing test for each bug or new format, then fix. New parsers need upstream-verified fixtures (`scripts/reference-fixtures.py`) or a documented reason why not.
3. Run `npm run typecheck`, `npm test`, `npm run build`, `npm run build:edge`, `npm run check:manifest`; run `npm run test:browser` and `npm run test:extension` when UI/worker code changes. `tests/static-guards.test.ts` encodes the invariants above; change it only together with a documented decision. Keep `THIRD_PARTY_NOTICES.md` current when bundled code or referenced projects change.
4. Live pixiv checks: distinguish NOT RUN from PASS/FAIL. Synthetic success is never live success. Do not evade bot challenges.
5. Update README/docs in the same change. Record evidence without images, prompts, credentials, artwork IDs or local paths.
6. Never push, publish, create releases/issues, or install into another browser profile without an explicit request.

## Current status (2026-11-22)
Implemented and synthetic-tested: hover previews (sweep-aware pages requests), multipage navigation, explicit inspection with the narrow pixiv Referer rule, local files (panels and the standalone `inspector.html` opened from the toolbar icon), PNG text, NovelAI Stealth (`stealth_pngcomp`, rows ≤ 1 MiB), NovelAI V4/V4.5 character captions, JPEG/WebP EXIF (A1111/Forge, ComfyUI WebP), bounded caches, cancellation, cooldowns. Not implemented: NovelAI signature verification, XMP/IPTC, 16-bit/interlaced Stealth. Live: the worker's original fetch returns 200 with the Referer. Live pixiv listing DOM, in-page Metadata, real Edge and metadata survival after posting are NOT VERIFIED (issues #11, #12). See `docs/TEST_STATUS.md`.
