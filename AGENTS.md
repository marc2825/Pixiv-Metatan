# AGENTS.md — pixiv AI Metadata Inspector

## Mission
Build a small, privacy-first Chrome/Edge MV3 extension that lets a user inspect the available AI-generation metadata from an image on an *artwork page they are viewing* on pixiv. The main differentiator is pixiv integration and evidence transparency, not bulk collection.

## Ground-truth files (read before editing)
1. `docs/REQUIREMENTS.md`: source of truth for scope, acceptance criteria, and non-goals.
2. `docs/ARCHITECTURE.md`: trust boundary, network flow, and supported metadata.
3. `docs/IMPLEMENTATION_PLAN.md`: milestones and stop/go checks.
4. `README.md`: instructions must match implemented behavior.

## Hard invariants
- No automated crawling/search-result sweeping, hidden downloads, proxying, or bypassing pixiv login, age restrictions, access controls, hotlink restrictions or rate limits.
- Scan **only after a user clicks Inspect** on the artwork currently open. One active image fetch at a time; no speculative prefetch.
- Accept source URLs only on `https://i.pximg.net/img-original/`; obtain original URLs from pixiv's currently accessible artwork data. Never reconstruct filenames blindly if authoritative data is available.
- Use only the minimum necessary MV3 permissions. Do not read cookies, credentials, tokens, browser history, or unrelated sites.
- Process image bytes locally. No telemetry, no third-party processing. Do not persist metadata without explicit opt-in.
- For pixiv 403/401/429, show clear non-bypass fallback: user-provided local original file. Do not add header spoofing, proxy services, or automatic retry loops.
- Never render untrusted metadata with `innerHTML`, `eval`, JS URL, executable markdown, or dynamically loaded remote JS. Use `textContent` and strict schemas/size limits.
- Never call a model/source 'proven NovelAI' merely because a `Software`, `Comment`, or `signed_hash` field exists. Explicit signature verification required for a verified badge. Other detection should say 'metadata indicates'.
- Unknown or absent metadata is not evidence an image is human-made. Image generation tools and web services may strip metadata.
- Preserve correct multi-page indexing and navigation. Treat pixiv JSON and metadata as untrusted input.
- Do not include real R18 images or copyrighted user images in the repository; use synthetic/generated-by-us test fixtures.
- Never silently add broad `*://*/*` host permissions or package tracking libraries. Never expose browser extension messaging as a generic URL fetch proxy.

## Preferred implementation
- TypeScript + WXT + MV3 + Vitest; no backend and no heavy UI framework for MVP.
- `entrypoints/`: isolated content UI vs background network privilege.
- `src/pixiv/`: pixiv-specific id/page/URL adapters.
- `src/metadata/`: pure parsers and safe normalized results independent of pixiv.
- `src/ui/`: presentational code; do not render image prompt text as HTML.
- Tests are required for new parsing formats, access failures, signature states, and URL validation.

## Workflow expected of Codex
1. Read specification. Inspect current code and TODOs. State a concise milestone plan.
2. Implement the highest priority incomplete milestone without expanding scope.
3. Run `npm run typecheck`, `npm test`, `npm run build` and fix failures.
4. For pixiv live checks, distinguish 'not run' from 'passed'; do not fabricate network verification.
5. Document changed files, testing evidence, remaining limits, and any risks.
6. Never push, publish, or install an extension to another profile without explicit request.

## Current prototype limitations
Gate 1 supports PNG tEXt/zTXt/iTXt, CRC and bounded inflation, streamed image limits, strict artwork/page/sender checks, cancellation and ordinary NovelAI Comment envelopes. The production MV3 build has been tested in temporary Chrome profiles against synthetic responses, including isolated content injection and runtime/worker messaging. Real pixiv connectivity returned a document-level 403 on 2026-10-23; artwork API/original fetching and real Edge remain unverified. It does **not** inspect NovelAI stealth alpha-channel metadata, separate V4/V5 character captions, decode JPEG/WebP/EXIF, or verify NovelAI signatures. PNG pixels are not decoded. See `docs/TEST_STATUS.md` and sanitized evidence; synthetic successes are not live pixiv successes. Gate 2 remains deferred until Gate 1's live acceptance is GO.
