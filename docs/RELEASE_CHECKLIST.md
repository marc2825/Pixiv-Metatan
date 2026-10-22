# Public release checklist

- [ ] The exact extension zip builds from a locked, reproducible toolchain.
- [ ] `npm run typecheck`, `npm test`, `npm run build` all PASS.
- [ ] Verified in Chrome/Edge and on real pixiv pages with owner-controlled artwork.
- [ ] PNG tEXt/zTXt/iTXt, Stealth and optional JPEG/WebP handling behave as advertised.
- [ ] No false 'verified NovelAI' statuses, even for spoofed signed_hash metadata.
- [ ] Permissions and static code inspected for unnecessary access.
- [ ] CSP, malformed XML/JSON, XSS metadata strings, decompression and image pixel limits reviewed.
- [ ] Handles 403/429 and auth failures without header spoofing or proxy fallback.
- [ ] No automated scraping, bulk collection, hidden external requests, telemetry or credential handling.
- [ ] Pixiv policies and Chrome Web Store policies reviewed for the shipped UX.
- [ ] Privacy policy, attribution, LICENSE, screenshots, versions and icon assets prepared.
- [ ] Third-party sample images and explicit copyrighted/R18 fixture assets are not included.
- [ ] Final release approved explicitly before pushing / publishing.
