# Security policy

Unreleased development build. See [verification status](docs/TEST_STATUS.md).

## Boundaries

- Only this extension's isolated top-frame pixiv content script may request inspection. Validate extension ID, frame, tab ID, exact current pixiv context URL before and after fetch, artwork ID, page and original URL. Requests without a context URL retain the original current-artwork-only restriction.
- Original URLs come from accessible same-origin artwork data and must use HTTPS and the exact `i.pximg.net/img-original/img/` pattern matching the artwork and page. No URL reconstruction. DOM and API display derivatives use a separate allowlist and cannot be passed off as originals.
- Hover/focus requests only that artwork's page list and current display derivative. Original bytes require Metadata / Inspect. No crawling, prefetch, generic fetch service, page-message bridge, remote code, cookie access, credential extraction, header spoofing, proxy or automatic retry.
- One active original operation globally, held until body reading/parsing settles. Timeouts and streamed 48 MiB caps, MIME/magic matching, request-scoped cancellation, navigation checks and 429 cooldowns.
- PNG structural/CRC checks, 2 MiB text budgets, 40 million pixels, chunk-count and JSON depth/node limits. Pixel data and cryptographic provenance remain unverified.
- Untrusted values render through textContent. RAW is lazy and read-only. Copies require a click. Bounded, short-lived caches remain in tab memory and clear on navigation/BFCache/teardown. Local files are not cached as artwork results.
- Signature strings are unverified claims. This build never produces verified/invalid signature states. Missing metadata cannot establish human authorship.
- Network access failures preserve available derivative display and an explicit local-file fallback. Server denial is not silently bypassed.

## Reporting

A private reporting channel remains a prerequisite for public release. Reports should use minimal synthetic fixtures and never include private artwork, prompts, authentication material or R18 content.

Automated tests use generated PNGs and intercepted HTTP. Actual pixiv markup, API/CDN behavior, login/access scope, real Edge and minimum-browser compatibility remain release gates. See [manual checks](docs/MANUAL_TESTS.md).
