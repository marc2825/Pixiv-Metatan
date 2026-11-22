import { MemoryCache } from '../cache';
import { RateLimitError } from '../network/failures';
import { getArtworkPages, type PixivPage } from './artworks';

interface Flight { controller: AbortController; promise: Promise<PixivPage[]>; waiters: number; settled: boolean }

/** Resolve/reject with `promise`, or reject as soon as `signal` aborts (the promise keeps running). */
function race<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * Per-tab pages-API scheduler (issue #14).
 * - At most one *wanted* request (one with a waiting caller) at a time; other artworks queue.
 * - A caller that leaves (abort) stops waiting immediately, but a request that has already been sent
 *   keeps running and fills the cache: aborting it would not reduce server work, and returning to the
 *   card would request it again. At most one such detached request is kept (an older one is aborted),
 *   so at most two requests are ever in flight.
 * - Requests for the same artwork are joined. Queued-but-unsent requests are dropped on abort.
 * - 429 cooldown is shared by both panels; clear() aborts everything and drops late results.
 */
export function createPageStore(fetchPages: typeof getArtworkPages = getArtworkPages) {
  const cache = new MemoryCache<PixivPage[]>(24, 2 * 1024 * 1024, 120_000);
  const flights = new Map<string, Flight>();
  let blockedUntil = 0, generation = 0;
  let wake: () => void = () => {};
  let changed = new Promise<void>(resolve => { wake = resolve; });
  const notify = () => { const resolve = wake; changed = new Promise<void>(next => { wake = next; }); resolve(); };
  const wantedBusy = () => [...flights.values()].some(flight => flight.waiters > 0);

  function start(id: string): Flight {
    const controller = new AbortController(), startedIn = generation;
    const flight: Flight = { controller, waiters: 0, settled: false, promise: Promise.resolve([]) };
    flight.promise = fetchPages(id, controller.signal).then(
      pages => { if (startedIn === generation) cache.set(id, pages); return pages; },
      (error: unknown) => { if (error instanceof RateLimitError) blockedUntil = Date.now() + error.retryMs; throw error; },
    ).finally(() => { flight.settled = true; if (flights.get(id) === flight) flights.delete(id); notify(); });
    flight.promise.catch(() => {}); // detached flights must not surface unhandled rejections
    flights.set(id, flight);
    return flight;
  }
  async function attach(flight: Flight, signal: AbortSignal): Promise<PixivPage[]> {
    flight.waiters++;
    try { return await race(flight.promise, signal); }
    finally {
      flight.waiters--;
      if (flight.waiters === 0 && !flight.settled) {
        // Keep only this newest detached request finishing in the background.
        for (const other of flights.values()) if (other !== flight && other.waiters === 0 && !other.settled) other.controller.abort();
      }
      notify();
    }
  }

  const load = async (id: string, signal: AbortSignal): Promise<PixivPage[]> => {
    signal.throwIfAborted();
    while (true) {
      const hit = cache.get(id);
      if (hit) return hit;
      const flight = flights.get(id);
      if (flight) return attach(flight, signal);
      if (!wantedBusy()) break;
      await race(changed, signal);
    }
    if (Date.now() < blockedUntil) throw new RateLimitError('pixiv-pages-http-429', blockedUntil - Date.now());
    return attach(start(id), signal);
  };
  return {
    load,
    /** Synchronous cache lookup (no request). */
    peek: (id: string) => cache.get(id),
    clear: () => { generation++; cache.clear(); for (const flight of flights.values()) flight.controller.abort(); flights.clear(); notify(); },
    prune: () => cache.prune(),
  };
}
