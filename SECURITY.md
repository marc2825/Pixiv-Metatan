# Security policy

## Supported versions

This project is an unreleased development build (0.1.x). Security fixes are made on `main`.

## Reporting a vulnerability

Please report privately. Do not open a public issue containing vulnerability details.

1. **Preferred:** GitHub private vulnerability reporting. Open the repository's **Security** tab and choose **Report a vulnerability**.
2. **If that button is not available:** GitHub only offers private vulnerability reporting on public repositories where the owner has enabled it. In that case, open an issue titled "Security contact request" **without any details**, and the maintainer will arrange a private channel.

Include a minimal, synthetic reproduction (for example a generated PNG). Never include private artwork, prompts from other people's images, cookies, tokens, HAR files or R18 content. Expect an acknowledgement within 7 days.

## Security boundaries

- **Who may ask for an inspection.** Only this extension's own top-frame content script on `https://www.pixiv.net`. The worker checks the extension ID, frame 0, tab ID, pixiv origin, the request schema and the live tab URL, before and after fetching. Artwork-panel requests are bound to the artwork ID shown in the tab; hover requests are bound to the exact page URL at the time of the click. Page scripts (`postMessage`) cannot reach the worker, external messaging is not enabled, and no message can make the extension fetch an arbitrary URL.
- **What may be fetched.** On hover: the pages API (same origin, from the content script) and display derivatives as ordinary `<img>` elements. On each click: one original image, from the worker, only for `https://i.pximg.net/img-original/img/…/{id}_p{page}.{png|jpg|jpeg|webp}` matching the artwork and page. URLs are never reconstructed. Host, scheme, port, user info, query, fragment and canonical form are checked exactly.
- **How originals are fetched.** `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, a 15 s timeout, one active operation across all tabs, MIME and magic-byte checks, a 48 MiB streamed limit and request-scoped cancellation. i.pximg.net requires a pixiv Referer, so one declarativeNetRequest session rule sets `Referer: https://www.pixiv.net/` on this request only: initiator = this extension, no tab, GET, `https://i.pximg.net/img-original/` (maintainer decision 2026-11-22, issue #9). The rule changes no response headers (no CORS rewriting), adds no cookies, and does not touch pixiv pages, other websites or other extensions. HTTP 429 starts a cooldown (Retry-After, minimum 60 s) in the worker and in the tab. There is no automatic retry, no cookie access, no proxy and no bulk download.
- **Parsing.** PNG structure and CRC checks; at most 4096 chunks and 128 text entries; a 2 MiB text budget; bounded zlib/gzip inflation; 40 million pixels; JSON depth 64 and 50,000 values. Stealth reading accepts only 8-bit non-interlaced alpha images with rows of at most 1 MiB (checked before allocating), stops after the magic rows when no payload exists, and caps the compressed payload at 1 MiB. EXIF reading bounds IFD counts, offsets and text size, and reads only listed text tags. Prototype-like keys are stored as plain data.
- **Rendering.** All untrusted text is rendered with `textContent` inside a closed shadow root. RAW views are lazy and read-only. Clipboard writes happen only on click.
- **Claims.** Signature strings are unverified claims; this build never produces `verified` or `invalid`. Missing metadata is never presented as evidence of human authorship.
- **Storage.** Short-lived, bounded caches live in tab memory only and are cleared on navigation, BFCache entry and teardown. Local files are not associated with artworks or cached as artwork results.
- **Permissions.** `declarativeNetRequestWithHostAccess` only (for the Referer rule above; it shows no extra install warning). Host permissions are limited to `www.pixiv.net` and `i.pximg.net`.

## Automated safeguards

- `npm run check:manifest` fails if the built manifests request more permissions, hosts or exposure than above.
- `tests/static-guards.test.ts` fails if extension code gains HTML-injection sinks, storage or cookie APIs, other network APIs, external messaging or new hosts, if it changes the original-fetch policy, or if it uses declarativeNetRequest outside the narrow Referer rule.
- CI (`.github/workflows/ci.yml`) runs with a read-only token and no secrets. It includes `npm audit --audit-level=high` and a gitleaks scan of the full history (pinned, checksum-verified binary, redacted output).

Automated tests use generated images and intercepted HTTP only. See [verification status](docs/TEST_STATUS.md) and [manual checks](docs/MANUAL_TESTS.md).
