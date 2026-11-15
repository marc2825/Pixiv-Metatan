import { MemoryCache } from '../cache';
import { RateLimitError } from '../network/failures';
import { getArtworkPages, type PixivPage } from './artworks';

/** One active pages API call per tab, even when an aborted fetch settles slowly. */
export function createPageStore(fetchPages: typeof getArtworkPages = getArtworkPages) {
  const cache = new MemoryCache<PixivPage[]>(24, 2 * 1024 * 1024, 120_000);
  let tail: Promise<unknown> = Promise.resolve();
  let blockedUntil = 0;
  const load = async (id: string, signal: AbortSignal): Promise<PixivPage[]> => {
    signal.throwIfAborted();
    const hit = cache.get(id);
    if (hit) return hit;
    const pending = tail;
    const task = (async () => {
      await pending.catch(() => {});
      signal.throwIfAborted();
      const secondHit = cache.get(id);
      if (secondHit) return secondHit;
      if (Date.now() < blockedUntil) throw new RateLimitError('pixiv-pages-http-429', blockedUntil - Date.now());
      try {
        const pages = await fetchPages(id, signal);
        signal.throwIfAborted(); cache.set(id, pages); return pages;
      } catch (error) {
        if (error instanceof RateLimitError) blockedUntil = Date.now() + error.retryMs;
        throw error;
      }
    })();
    // No retained unhandled rejection. UI owns the actual task result.
    tail = task.catch(() => {});
    return task;
  };
  return { load, clear: () => cache.clear(), prune: () => cache.prune() };
}
