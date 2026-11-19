# Verification status — 2026-11-19 (JST)

**Implementation and synthetic tests: PASS. Live pixiv acceptance: not done. The hover UI is NOT VERIFIED on real pages, and the original fetch was measured as rejected (403).**

## Automated results

| Command | Result | Scope |
|---|---|---|
| `npm run typecheck` | PASS | WXT prepare + TypeScript strict (src, entrypoints, tests, scripts) |
| `npm test` | PASS — 10 files / 279 tests | Parsers, 12 upstream-verified reference fixtures, URL/authorisation, worker, DOM races, caches, wheel, UI rendering (191 tests before this audit, all kept) |
| `npm run build` | PASS | Chrome MV3, 96.63 kB (background 29.1 kB, content 61.7 kB, icons) |
| `npm run build:edge` | PASS | Edge MV3, same size. A build, not a run in real Edge |
| `npm run check:manifest` | PASS | Chrome/Edge: no API permissions; hosts pixiv/pximg only; top-frame isolated script |
| `npm run test:browser` | PASS — 12 tests | Test adapter, synthetic pages and HTTP, Chromium 156 |
| `npm run test:extension` | PASS — 17 tests | Production MV3 (closed root, runtime messaging, worker) in disposable profiles; all HTTP synthetic ([evidence](evidence/mv3-synthetic-2026-11-19.json)) |
| `npm audit` | 0 vulnerabilities | devDependencies only |
| `git diff --check` | PASS | |
| GitHub Actions CI | PASS | First run [44462959593](https://github.com/marc2825/pixiv-ai-metadata-inspector/actions/runs/44462959593) on `15a76f9`: verify jobs on Node 22 and 24, and the Playwright job, all green on GitHub-hosted runners. Every Dependabot PR (#1–#6) also passed all three jobs before merging |

Reference fixtures (`scripts/reference-fixtures.py`) were regenerated with pinned, hash-checked upstream code. NovelAI's official Stealth writer and reader, ComfyUI `SaveImage` and `_create_webp_metadata`, and AUTOMATIC1111 v1.10.1 `save_image_with_geninfo` / `read_info_from_image` all passed their read-backs. The six older fixtures were reproduced byte-for-byte.

## Live pixiv (2026-11-19)

| Check | Result | Notes |
|---|---|---|
| Document, automated headless Chromium 156 | FAIL (403) | Cloudflare managed challenge (`cf-mitigated: challenge`, "Just a moment..."). Not solved or evaded ([evidence](evidence/live-connectivity-2026-11-19.json)) |
| Document, plain HTTP client | PASS (200) | No cookies |
| Pages API, plain HTTP, one public artwork | PASS (200, JSON) | URL shapes (`thumb_mini`, `small`, `regular`, `original`) match the validators |
| Original, no cookie / no Referer (worker profile) | FAIL (403) | Derivative also 403. The extension does not work around this by policy ([evidence](evidence/live-layers-2026-11-19.json)) |
| Original or derivative with a pixiv Referer | NOT RUN | Would require forging headers outside a real page |
| Extension inside a real pixiv tab (listing DOM, preview `<img>`, worker fetch) | NOT RUN | Blocked at document level for automation; needs [manual GUI check](MANUAL_TESTS.md) |
| Logged-in / age-restricted scope | NOT RUN | No credentials imported |
| Real Edge, Chrome/Edge 120, high DPI, long sessions | NOT RUN | |
| Stealth/V4/EXIF on real generated images | NOT RUN | Synthetic upstream-verified fixtures only |
| NovelAI signature verification | Not implemented | Never shows verified/invalid |

The live-connectivity file records the artifact hashes of the build at measurement time. The final build hashes are in the synthetic evidence file.

## What the automated tests cover

- PNG structure/CRC/order, tEXt/zTXt/iTXt, Latin-1/UTF-8 (BOM kept), duplicates, prototype-like keys, compression bombs, size/pixel/chunk/JSON limits, cancellation.
- Stealth: all five PNG filter types, multi-column magic for short images, grey+alpha, early exit (corruption after row 120 never decoded), unsupported layouts, `stealth_pnginfo` detection, truncated/oversized/invalid-gzip/gzip-bomb payloads, non-JSON payloads, text-vs-Stealth disagreement notes.
- EXIF: MM/II UTF-16, ASCII/undefined UserComment, ComfyUI tags only in the documented IFD0 range, malformed JPEG/WebP/TIFF structures, offsets, IFD counts, executable-looking text as data.
- V4/V4.5 captions: per-character prompts/negatives/positions, schema mismatches flagged, bounds.
- pixiv: live-observed URL shapes, page order, non-inspectable pages without renumbering, foreign/mismatched originals rejected, `error:true` and 4xx JSON messages sanitised, 429/timeout/HTTP classification.
- Thumbnail detection: nested targets, multiple images, hovered-image preference, `currentSrc`, lazy placeholders, recycled cards, overlay cards, no guessing outside links, no borrowed authors, bounds.
- Worker: sender/frame/tab/context checks before and after fetch, artwork-bound vs URL-bound requests, structured failures with Retry-After, global single slot, cancellation, timeout, MIME/magic, streamed limits.
- UI: 250 ms / 200 ms timing, wheel gestures, keys, Escape propagation, focus retention, tab-level cooldown, non-inspectable pages, `srcset`, single shared ticker, host re-attachment, SPA/BFCache, local files never assigned to artworks, text-only rendering, click-only copy.

Test-assertion changes in this audit only followed intended behaviour changes (JPEG is now parsed; new labels). Each kept the original guarantee, and none were deleted.

## Environment

Linux x64 (WSL2), Node 24.21.0, npm 11.19.0, Chromium 156.0.8078.4. Re-run on 2026-11-19 after the Dependabot updates (TypeScript 7.0.2, jsdom 31.0.1, Playwright 1.65.1, Vite 8.3.8, Vitest 5.1.0, WXT 0.21.5): typecheck, 279 Vitest tests, both builds, the manifest guard, 12 browser and 17 production MV3 tests all pass. TypeScript 7.0.2 reported the same diagnostics as 5.9.3 on a probe file of deliberate strictness violations. Chromium's missing system libraries (NSS, ALSA) were extracted to a temporary directory for this run only; nothing was installed into the OS or repository. On a normal machine use `npx playwright install --with-deps chromium`. Temporary browser profiles were deleted after each run; no existing user profile was used.

## 公開判定

| 対象 | 判定 | 根拠 |
|---|---|---|
| GitHubでのソース公開 | CONDITIONAL GO | 秘密情報・第三者画像・個人のローカルパスなし。ライセンス・文書・試験あり。GitHub上のCIは成功済み。残る条件: private vulnerability reportingの有効化（リポジトリ設定） |
| GitHub Releasesでの配布 | NO-GO | 実タブでのホバー・一覧検出が未確認。Metadataは実pixivで403になる想定。手動受入（MANUAL_TESTS 1〜8）後に、制限を明記したプレリリースとして再判定 |
| Chrome Web Store | NO-GO | 上記に加え、プライバシーポリシーURL・ストア素材・名称（第三者商標）・pixiv規約の確認が未了。主要機能（原寸取得）が方針により実pixivで動作しない |
