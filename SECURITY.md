# Security policy

This is an unreleased development build. See [verification status](docs/TEST_STATUS.md) before using it on real artwork.

## Boundaries

- Original image requests are accepted only from this extension's top-frame pixiv content script, for the artwork currently open in that tab. The original URL must match its artwork ID and selected page, use HTTPS, and be under the exact `i.pximg.net/img-original/img/` path. URLs originate from accessible pixiv artwork data; they are never reconstructed.
- No page-message bridge, generic fetch service, remote code, tracking, cookie access, credential extraction, header spoofing, proxying or automatic retries.
- One active image operation globally. Requests/body reads time out, streams enforce 48 MiB, and content types must match file signatures. Access failures lead to an explicit local-file fallback.
- PNG structural/CRC checks, 2 MiB text budgets, 40 million pixels, chunk-count and JSON depth/node limits. This version does not decode pixel data or verify provenance.
- Untrusted values render through textContent. RAW is lazy and read-only; copies require a click. No persistent metadata storage.
- Signature fields are unverified claims. This build never emits a verified badge.

## Reporting

Before public release, a private reporting channel must be configured. Do not include private artwork, prompts, authentication material, original private URLs or R18 content in a public report. A minimal synthetic fixture and reproduction steps are sufficient for parser or boundary defects.

The automated tests use synthetic PNGs and intercepted network responses. Live pixiv access controls, actual extension execution in Chrome/Edge and minimum-browser compatibility remain release gates. See [manual checks](docs/MANUAL_TESTS.md).
