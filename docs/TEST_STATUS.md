# Verification status (2026-10-22)

## PASS (checked in the artifact creation environment)
- Core TypeScript files compile with globally available `tsc` 5.8.3 using strict, noUncheckedIndexedAccess, ES2022 and DOM types.
- Node smoke test compiled and executed: synthetic tEXt PNG recognized as NovelAI and ComfyUI; fake `signed_hash` correctly remained `not-checked`.
- File tree and intended scaffold structure exist.

## NOT RUN / BLOCKED
- `npm install`: package download timed out in the authoring environment; no `node_modules` or lockfile produced.
- Full WXT project `npm run typecheck`, `npm test`, and `npm run build`: not run due to missing install dependencies.
- Browser integration, pixiv original image fetch (200/403), SPA navigation, local file picker UX: not run.
- JPEG/WebP metadata, compressed PNG text, NovelAI alpha stealth and cryptographic signature verification: not implemented.

## Known gaps that Codex should fix before release
- `src/metadata/png.ts` has no CRC validation and doesn't implement zTXt or compressed iTXt.
- The initial background fetch uses `response.arrayBuffer()` after Content-Length check; needs true streaming byte limit.
- Worker should verify image filename belongs to current pixiv artwork ID and enforce exactly one active fetch, cancellation.
- NovelAI provenance remains self-reported unless cryptographic verification is added.
- No browser E2E tests currently.
