import { InspectionError, MAX_PAGES, readResponse, TIMEOUT_MS } from '../limits';
import { isRecord } from '../metadata/normalize';
import { RateLimitError, retryAfterMs } from '../network/failures';

/**
 * One API page in authoritative order. `original` is absent when pixiv returned a URL shape this
 * extension does not inspect (e.g. GIF/ugoira); the page keeps its index and may still be previewed.
 */
export interface PixivPage {
  page: number; original?: string; preview?: string; previewSmall?: string; unavailable?: string;
  /** Pixel size reported by pixiv, used only to reserve the preview's aspect ratio before it loads. */
  width?: number; height?: number;
}
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

const ORIGINAL_SHAPE = /^\/img-original\/img\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/([1-9]\d{0,19})_p(0|[1-9]\d*)\.([a-z0-9]{2,5})$/;

/**
 * Classify an API original for page listing. Recognised originals for another artwork/page are a
 * schema violation (throw: never renumber or mix pages). An unrecognised i.pximg.net path or file
 * type only makes that page non-inspectable. The worker still applies validatePixivImageUrl.
 */
export function classifyOriginal(url: string, artworkId: string, page: number): { original?: string; unavailable?: string } {
  try { return { original: validatePixivImageUrl(url, artworkId, page) }; }
  catch (error) { if (!(error instanceof InspectionError) || error.code !== 'image-artwork-mismatch') throw error; }
  const match = ORIGINAL_SHAPE.exec(new URL(url).pathname);
  if (match && (match[1] !== artworkId || Number(match[2]) !== page)) throw new InspectionError('image-artwork-mismatch');
  return { unavailable: match ? 'unsupported-original-format' : 'unrecognized-original-url' };
}

/** Display-only derivatives; never promote a thumbnail into an original URL. */
export function validatePreviewUrl(url: string, artworkId: string, page?: number): string {
  if (typeof url !== 'string' || url.length > 2048 || !/^[1-9]\d{0,19}$/.test(artworkId)) throw new InspectionError('unapproved-preview-url');
  let u: URL;
  try { u = new URL(url); } catch { throw new InspectionError('unapproved-preview-url'); }
  if (u.origin !== 'https://i.pximg.net' || u.username || u.password || u.search || u.hash || u.href !== url) throw new InspectionError('unapproved-preview-url');
  const match = /^\/(?:c\/[a-zA-Z0-9_-]{1,80}\/)?(?:img-master|custom-thumb)\/img\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/([1-9]\d{0,19})_p(0|[1-9]\d*)_(?:master|square|custom)\d{2,4}\.(?:jpg|jpeg|png|webp)$/.exec(u.pathname);
  if (!match || match[1] !== artworkId || Number(match[2]) >= MAX_PAGES || (page !== undefined && Number(match[2]) !== page)) throw new InspectionError('preview-artwork-mismatch');
  return u.href;
}

/** pixiv error text is untrusted: plain text only, control characters removed, length-limited. */
export function pixivMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 200);
  return text || undefined;
}

export function parseArtworkPages(payload: unknown, id: string): PixivPage[] {
  if (isRecord(payload) && payload.error === true) throw new InspectionError('pixiv-pages-error', pixivMessage(payload.message));
  if (!isRecord(payload) || payload.error !== false || !Array.isArray(payload.body) || !payload.body.length || payload.body.length > MAX_PAGES) throw new InspectionError('unexpected-pixiv-schema');
  // Never skip malformed elements: skipping would silently change page numbering.
  return payload.body.map((item: unknown, page) => {
    if (!isRecord(item) || !isRecord(item.urls) || typeof item.urls.original !== 'string') throw new InspectionError('unexpected-pixiv-schema');
    const urls = item.urls;
    const result: PixivPage = { page, ...classifyOriginal(item.urls.original, id, page) };
    // Optional invalid derivatives must not disable a valid original or alter indexing.
    const derivative = (key: string) => {
      const value = urls[key];
      if (typeof value !== 'string') return undefined;
      try { return validatePreviewUrl(value, id, page); } catch { return undefined; }
    };
    const regular = derivative('regular'), small = derivative('small');
    if (regular ?? small) result.preview = regular ?? small;
    if (regular && small) result.previewSmall = small;
    // Optional and display-only: an implausible size is dropped, never an error.
    const size = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 100_000 ? value : undefined;
    const width = size(item.width), height = size(item.height);
    if (width && height) { result.width = width; result.height = height; }
    return result;
  });
}

/** Read a small JSON error body (4xx only) so the user sees pixiv's own reason, if any. */
async function errorMessage(response: Response, signal: AbortSignal): Promise<string | undefined> {
  if (response.status < 400 || response.status > 499 || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return undefined;
  try {
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readResponse(response, 64 * 1024, signal)));
    return isRecord(payload) ? pixivMessage(payload.message) : undefined;
  } catch { return undefined; }
}

/** Undocumented, same-origin endpoint. No images are fetched by this operation. */
export async function getArtworkPages(id: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<PixivPage[]> {
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new InspectionError('invalid-artwork-id');
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const response = await fetcher(`https://www.pixiv.net/ajax/illust/${id}/pages`, { credentials: 'same-origin', redirect: 'error', signal: combined });
    if (!response.ok) {
      if (response.status === 429) { void response.body?.cancel().catch(() => {}); throw new RateLimitError('pixiv-pages-http-429', retryAfterMs(response.headers.get('retry-after'))); }
      const detail = await errorMessage(response, combined);
      void response.body?.cancel().catch(() => {});
      throw new InspectionError(`pixiv-pages-http-${response.status}`, detail);
    }
    if (response.redirected) { void response.body?.cancel().catch(() => {}); throw new InspectionError('pixiv-pages-redirect-denied'); }
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { void response.body?.cancel().catch(() => {}); throw new InspectionError('pixiv-pages-content-type'); }
    const bytes = await readResponse(response, 1024 * 1024, combined);
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new InspectionError('unexpected-pixiv-json'); }
    return parseArtworkPages(payload, id);
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new InspectionError('pixiv-pages-timeout');
    throw error;
  }
}
