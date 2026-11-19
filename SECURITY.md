# Security policy

## Supported versions

This project is an unreleased development build (0.1.x). Security fixes are made on `main`.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting). Do not open a public issue for security problems.

Include a minimal, synthetic reproduction (for example a generated PNG). Never include private artwork, prompts from other people's images, cookies, tokens, HAR files or R18 content. Expect an acknowledgement within 7 days.

> Maintainer note: private vulnerability reporting must be enabled in the repository settings before public release (see `docs/RELEASE_CHECKLIST.md`).

## Security boundaries

- **Who may ask for an inspection.** Only this extension's own top-frame content script on `https://www.pixiv.net`. The worker checks the extension ID, frame 0, tab ID, pixiv origin, the request schema and the live tab URL before and after fetching. Artwork-panel requests are bound to the artwork ID shown in the tab; hover requests are bound to the exact page URL at the time of the click. Page scripts (`postMessage`) cannot reach the worker, and there is no generic fetch message.
- **What may be fetched.** The pages API (same-origin, from the content script) on hover, plus display derivatives as ordinary `<img>` elements. One original image per click, from the worker, only for `https://i.pximg.net/img-original/img/…/{id}_p{page}.{png|jpg|jpeg|webp}` matching the artwork and page. URLs are never reconstructed.
- **How originals are fetched.** `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, 15 s timeout, one active operation across all tabs, MIME and magic-byte checks, a 48 MiB streamed limit, and request-scoped cancellation. HTTP 429 starts a cooldown (Retry-After, minimum 60 s) in the worker and in the tab. There is no automatic retry, no header forgery, no cookie access and no proxy. i.pximg.net currently rejects these requests (403). That is reported to the user, not worked around.
- **Parsing.** PNG structure and CRC checks, at most 4096 chunks and 128 text entries, a 2 MiB text budget, bounded zlib/gzip inflation, 40 million pixels, JSON depth 64 and 50,000 values. Stealth reading accepts only 8-bit non-interlaced alpha images, stops after the magic rows when no payload exists, and caps the compressed payload at 1 MiB. EXIF reading bounds IFD counts, offsets and text size and reads only listed text tags. Prototype-like keys are stored as plain data.
- **Rendering.** All untrusted text is rendered with `textContent` inside a closed shadow root. RAW views are lazy and read-only. Clipboard writes happen only on click.
- **Claims.** Signature strings are unverified claims; this build never produces `verified` or `invalid`. Missing metadata is never presented as evidence of human authorship.
- **Storage.** Short-lived, bounded caches live in tab memory only and are cleared on navigation, BFCache entry and teardown. Local files are not associated with artworks or cached as artwork results.
- **Permissions.** No API permissions; host permissions are limited to `www.pixiv.net` and `i.pximg.net`. `npm run check:manifest` fails the build check if this changes.

Automated tests use generated images and intercepted HTTP only. See [verification status](docs/TEST_STATUS.md) and [manual checks](docs/MANUAL_TESTS.md).
