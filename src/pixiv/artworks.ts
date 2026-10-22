export interface PixivPage {
  page: number;
  original: string;
  regular?: string;
}

export function artworkIdFromUrl(location: string): string | null {
  const u = new URL(location);
  if (u.protocol !== 'https:' || u.hostname !== 'www.pixiv.net') return null;
  const match = /^\/artworks\/(\d+)(?:\/|$)/.exec(u.pathname);
  return match?.[1] ?? null;
}

export function validatePixivImageUrl(url: string): string {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'i.pximg.net' || !u.pathname.startsWith('/img-original/')) {
    throw new Error('unapproved-image-url');
  }
  if (u.username || u.password || u.port || u.search || u.hash) throw new Error('unapproved-image-url');
  return u.href;
}

/** Undocumented site endpoint: treat results as untrusted, gracefully fall back when unavailable. */
export async function getArtworkPages(id: string): Promise<PixivPage[]> {
  if (!/^\d+$/.test(id)) throw new Error('invalid-artwork-id');
  // Same-origin from content script. Do not try to bypass login/403 restrictions.
  const response = await fetch(`/ajax/illust/${id}/pages`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`pixiv-pages-http-${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !('body' in payload) || !Array.isArray(payload.body)) {
    throw new Error('unexpected-pixiv-schema');
  }
  const pages: PixivPage[] = [];
  for (const [page, item] of payload.body.entries()) {
    const original = item?.urls?.original;
    if (typeof original === 'string') {
      pages.push({ page, original: validatePixivImageUrl(original), regular: item?.urls?.regular });
    }
  }
  return pages;
}
