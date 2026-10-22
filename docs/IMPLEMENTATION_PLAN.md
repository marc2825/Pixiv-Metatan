# Implementation milestones and gates

## Gate 0 — Feasibility first
- [ ] Install deps; run typecheck / tests / build; fix starter defects.
- [ ] Confirm `https://www.pixiv.net/artworks/{id}` page injection; 1 and multiple images.
- [ ] Confirm authorized `/ajax/illust/{id}/pages` returns original URLs.
- [ ] Test MV3 background `fetch` on permitted original; record 200/403/cause.
- [ ] If fetch restricted, retain manual-file fallback; do not spoof Referer or bypass authentication.
- [ ] Record browser version, URL type, status codes; sanitize private content.

## Gate 1 — Releaseable MVP (P0)
- [ ] PNG text chunk parser: tEXt, zTXt, iTXt compressed/uncompressed, CRC and safe bounded inflation.
- [ ] Robust NovelAI normal metadata, ComfyUI workflow JSON, A1111/Forge parameters.
- [ ] Evidence-based result model, distinction between detection and verification.
- [ ] UI: page picker, error/fallback, read-only prompt fields, raw view, keyboard and accessibility, copy.
- [ ] Streamed fetch cap, HTML sanitization-by-construction, strict messaging sender + URL checking, all network only on click.
- [ ] Unit, integration, and browser manual tests; Chrome and Edge packages.
- [ ] README, security policy, privacy statement and screenshots reflect actual tested behavior.

## Gate 2 — NovelAI deep parsing (P1)
- [ ] Alpha stealth PNG info + compressed stealth info in browser. Consult NovelAI MIT repository.
- [ ] V4/V5 character captions (multiple characters) and negative prompts.
- [ ] Cryptographic signature verification or clear 'not checked'.
- [ ] JPEG/WebP common metadata and metadata stripping diagnostics.
- [ ] Multi-page cancellation, on-page marker once inspected; no mass crawler.

## Gate 3 — Publish (P2)
- [ ] English/Japanese polished UI, dark mode support, icon set, store listing.
- [ ] Publish privacy policy, licenses, attribution; supply no real R18 sample images.
- [ ] Audit dependency versions/license/security and extension permissions.
- [ ] Chrome Web Store compliance review, pixiv terms review; publish only after explicit approval.

## Stop/GO reporting
- Gate status `GO`, `NO-GO`, or `NOT RUN` with test evidence.
- No declaring signature verification or real pixiv live success without direct tests.
- Do not push remote branches, publish release, or transmit user image data without explicit instruction.
