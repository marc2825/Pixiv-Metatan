import { artworkIdFromUrl, validatePreviewUrl } from './artworks';

export interface Thumbnail {
  anchor: HTMLAnchorElement; artworkId: string; image: string; title?: string; author?: string;
}

const MAX_CANDIDATES = 8;
const USER_PATH = /^\/(?:[a-z]{2}\/)?users\/[1-9]\d{0,19}\/?$/;

/** First image whose displayed URL is a safe pximg derivative for exactly this artwork, page 0. */
function matchingImage(images: Iterable<HTMLImageElement>, artworkId: string): { img: HTMLImageElement; url: string } | undefined {
  let checked = 0;
  for (const img of images) {
    if (++checked > MAX_CANDIDATES) return undefined;
    // currentSrc reflects the srcset candidate actually shown; src is the fallback before load.
    for (const url of new Set([img.currentSrc, img.src])) {
      if (!url) continue;
      try { return { img, url: validatePreviewUrl(url, artworkId, 0) }; } catch { /* not this one */ }
    }
  }
  return undefined;
}

/**
 * Delegated detection: no document-wide scan or dependency on pixiv CSS classes.
 * Accepted structures (all require the image URL to encode the link's artwork ID):
 * 1. <a href="/artworks/ID"> ... <img> ... </a>  (hovered image preferred, then up to 8 images)
 * 2. an overlay link whose card container (the link's parent) holds the thumbnail image.
 * An image outside any artwork link is not associated by guessing.
 */
export function thumbnailFromTarget(target: EventTarget | null): Thumbnail | undefined {
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>('a[href]');
  if (!anchor) return;
  const artworkId = artworkIdFromUrl(anchor.href);
  if (!artworkId) return;
  const hovered = target instanceof HTMLImageElement ? [target] : [];
  const found = matchingImage([...hovered, ...anchor.querySelectorAll('img')], artworkId)
    ?? (anchor.parentElement ? matchingImage(anchor.parentElement.querySelectorAll(':scope > img, :scope > * > img'), artworkId) : undefined);
  if (!found) return;
  const title = (found.img.alt || anchor.title || anchor.getAttribute('aria-label') || '').trim().slice(0, 300) || undefined;
  // Only a list item/article is a reliable card boundary; a wider container may hold other cards' authors.
  const card = anchor.closest('li,article');
  let author: string | undefined;
  for (const link of card?.querySelectorAll<HTMLAnchorElement>('a[href*="/users/"]') ?? []) {
    try {
      const u = new URL(link.href);
      const text = link.textContent?.trim();
      // The avatar link usually has no text; use the first user link that names the author.
      if (u.origin === 'https://www.pixiv.net' && USER_PATH.test(u.pathname) && text) { author = text.slice(0, 160); break; }
    } catch { /* optional label */ }
  }
  return { anchor, artworkId, image: found.url, title, author };
}
