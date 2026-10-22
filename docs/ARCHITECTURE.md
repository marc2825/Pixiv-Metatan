# 技術設計 / Architecture

## A. 境界図

```
pixiv artwork page
  └─ isolated content script (WXT)
       ├─ UI in closed Shadow DOM; explicit clicks only
       ├─ current artwork ID + same-origin GET /ajax/illust/{id}/pages
       ├─ validates each returned i.pximg.net/img-original URL
       └─ runtime message {type:INSPECT_PIXIV_IMAGE, url}
                  ↓
        MV3 background service worker
         ├─ validates sender pixiv artwork page URL
         ├─ validates exact HTTPS image host + path
         ├─ image fetch (permissions limited to pixiv/pximg)
         ├─ timeout / byte / content-type / redirect guard
         └─ parses metadata locally → normalized result
                  ↓
             content UI (safe textContent)

fallback: user-chosen local PNG → parse locally in the content script
```

### Reality check / risks
1. `/ajax/illust/{id}/pages` is an **undocumented pixiv endpoint**, not a stable API contract. Site may change or restrict it.
2. `i.pximg.net` may reject extension-origin requests due to Referer/session access control. MV3 host permission ≠ guaranteed successful HTTP fetch. **No header spoofing / access-bypass**. User-supplied image file is the required fallback; test the fetch capability before investing in UI polish.
3. MV3 content scripts obey same-origin restrictions. Cross-origin original image retrieval belongs in service worker, whose cross-origin access needs host permission. The service worker lacks DOM/canvas. For PNG alpha-steganography use an appropriate extension page/offscreen document if necessary; obtain only needed permissions.
4. Distinguish tool (ComfyUI) and generator/engine (NovelAI model). They may coexist. Detection uses self-reported metadata unless verified signature.

## B. Data model

`InspectionResult`:
```
status: found | no-metadata | unsupported-format | access-denied | too-large | parse-error
format: png | jpeg | webp | other
generator: novelai | comfyui | a1111-forge | unknown
confidence: metadata-indicates | weak | unknown
novelaiSignature: not-checked | not-present | verified | invalid
fields: Record<string,string>
rawTextChunks: Record<string,string>
notes: string[]
```

P1 should add `engines: GeneratorKind[]` and `evidence[]` so mixed generator/tool data is not forced to one label.

## C. PNG chunks
- PNG signature, chunk length big endian, 4-char ASCII type, data, CRC32.
- tEXt: keyword NUL Latin-1 string.
- zTXt: keyword NUL compression method 0 + zlib-compressed string.
- iTXt: keyword NUL compression flag + method + language NUL + translated keyword NUL + UTF-8 text (optionally compressed).
- Validate chunk lengths and CRC, bounded inflate and total text budget, don't parse full pixel payload for text-only cases.
- `Description`, `Software`, `Comment` indicate NovelAI in some versions. Do not assume values/key stability.
- `prompt`, `workflow` are common ComfyUI JSON keys. ComfyUI prompt is *API graph*, not a single human-readable positive string; multiple CLIP encoders, custom nodes, links, and prompt schedules may be present.
- `parameters` is common A1111/Forge text metadata.
- NovelAI Stealth PNG uses LSB alpha data in `stealth_pnginfo`/`stealth_pngcomp` formats. Follow official implementation exactly; decompression after decoding must be bounded. NovelAI signature verification is a separate cryptographic operation.
- WebP may carry EXIF and Stealth; JPEG may have EXIF/XMP with vendor data. Extra formats are P1.

## D. Security handling
- Source URL validation and sender validation **on the privileged worker**, not only on content page.
- Use `fetch` without credentials for i.pximg.net. Never inspect cookies or use proxy services to bypass pixiv access control.
- No arbitrary redirect following, no URL rewrite to bypass denial.
- Buffering **entire image** is temporary prototype behavior; P0 release gate requires streaming byte cap (48MiB) even if Content-Length omitted. Limit decoded pixels for alpha analysis (e.g., <=40 million).
- Metadata can include adversarial prompt text, HTML, giant JSON, broken UTF-8 or intentionally misleading `Software` values. Render via `textContent`, not `innerHTML`.
- Strictly separate source evidence from display labels; raw `signed_hash` does not mean verified.
- Browser cache naturally caches fetches, but the extension stores no user metadata in local storage.

## E. Browser test matrix
- Chrome, Edge recent versions; pixiv single page/multi-page (1/10 pages), SPA navigation, signed in/out, adult-accessible work legitimately visible, original JPEG vs PNG.
- Network: original 200, pixiv API denied, pximg 403, 429, 404, connection interruption, timeout; no retry beyond user clicks.
- Data: NovelAI tEXt, stealth-only, compressed, V5 character captions, ComfyUI workflow-only, A1111 parameters, corrupt PNG, huge dimensions, fake signed_hash, mixed formats, no metadata.
- Version pinning and exact reference fixture provenance (synthetic fixtures can be committed, third-party copyrighted content should not).
