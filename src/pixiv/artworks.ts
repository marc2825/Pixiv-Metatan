import { InspectionError, MAX_PAGES, readResponse, TIMEOUT_MS } from '../limits';
import { isRecord } from '../metadata/normalize';

export interface PixivPage { page: number; original: string }
export function isPixivPage(url: string): boolean {
  try { const u = new URL(url); return u.origin === 'https://www.pixiv.net' && !u.username && !u.password; }
  catch { return false; }
}
export function artworkIdFromUrl(url: string): string | null {
  if (!isPixivPage(url)) return null;
  return /^\/(?:[a-z]{2}\/)?artworks\/([1-9]\d{0,19})\/?$/.exec(new URL(url).pathname)?.[1] ?? null;
}

/** Validate an authoritative URL; never construct an original URL from these parts. */
export function validatePixivImageUrl(url: string, artworkId: string, page: number): string {
  if (typeof url !== 'string' || url.length > 2048 || !/^[1-9]\d{0,19}$/.test(artworkId) || !Number.isInteger(page) || page < 0 || page >= MAX_PAGES) throw new InspectionError('unapproved-image-url');
  let u: URL;
  try { u = new URL(url); } catch { throw new InspectionError('unapproved-image-url'); }
  if (u.protocol !== 'https:' || u.hostname !== 'i.pximg.net' || u.username || u.password || u.port || u.search || u.hash || u.href !== url) throw new InspectionError('unapproved-image-url');
  const match = /^\/img-original\/img\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/([1-9]\d{0,19})_p(0|[1-9]\d*)\.(png|jpg|jpeg|webp)$/.exec(u.pathname);
  if (!match || match[1] !== artworkId || Number(match[2]) !== page) throw new InspectionError('image-artwork-mismatch');
  return u.href;
}

export function parseArtworkPages(payload: unknown, id: string): PixivPage[] {
  if (!isRecord(payload) || payload.error !== false || !Array.isArray(payload.body) || !payload.body.length || payload.body.length > MAX_PAGES) throw new InspectionError('unexpected-pixiv-schema');
  // Never skip malformed elements: skipping would silently change page numbering.
  return payload.body.map((item: unknown, page) => {
    if (!isRecord(item) || !isRecord(item.urls) || typeof item.urls.original !== 'string') throw new InspectionError('unexpected-pixiv-schema');
    return { page, original: validatePixivImageUrl(item.urls.original, id, page) };
  });
}

/** Undocumented, same-origin endpoint. No images are fetched by this operation. */
export async function getArtworkPages(id: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PixivPage[]> {
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new InspectionError('invalid-artwork-id');
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetcher(`https://www.pixiv.net/ajax/illust/${id}/pages`, { credentials: 'same-origin', redirect: 'error', signal: combined });
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new InspectionError(`pixiv-pages-http-${response.status}`); }
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { void response.body?.cancel().catch(() => {}); throw new InspectionError('pixiv-pages-content-type'); }
  const bytes = await readResponse(response, 1024 * 1024, combined);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new InspectionError('unexpected-pixiv-json'); }
  return parseArtworkPages(payload, id);
}
