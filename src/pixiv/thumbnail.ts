import { artworkIdFromUrl, validatePreviewUrl } from './artworks';

export interface Thumbnail {
  anchor: HTMLAnchorElement; artworkId: string; image: string; title?: string; author?: string;
}

/** Delegated detection: no document-wide scan or dependency on pixiv CSS classes. */
export function thumbnailFromTarget(target: EventTarget | null): Thumbnail | undefined {
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return;
  const artworkId = artworkIdFromUrl(anchor.href);
  const img = anchor.querySelector('img');
  if (!artworkId || !img) return;
  let image: string;
  try { image = validatePreviewUrl(img.currentSrc || img.src, artworkId, 0); } catch { return; }
  const title = (img.alt || anchor.title).trim().slice(0, 300) || undefined;
  const card = anchor.closest('li,article');
  const authorLink = card?.querySelector<HTMLAnchorElement>('a[href*="/users/"]');
  let author: string | undefined;
  if (authorLink) {
    try {
      const u = new URL(authorLink.href);
      if (u.origin === 'https://www.pixiv.net' && /^\/(?:[a-z]{2}\/)?users\/[1-9]\d{0,19}\/?$/.test(u.pathname)) author = authorLink.textContent?.trim().slice(0, 160) || undefined;
    } catch { /* optional label */ }
  }
  return { anchor, artworkId, image, title, author };
}
