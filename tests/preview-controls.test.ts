import { describe, expect, it, vi } from 'vitest';
import { MemoryCache } from '../src/cache';
import { PageWheel, previewPosition } from '../src/ui/preview-controls';
import { createPageStore } from '../src/pixiv/page-store';
import { RateLimitError, retryAfterMs } from '../src/network/failures';
import { originalUrl } from './fixtures';

describe('bounded tab caches and API scheduling', () => {
  it('expires sensitive results, bounds entry count and bytes, and refreshes LRU order', () => {
    let now = 0; const cache = new MemoryCache<string>(2, 80, 100, () => now);
    cache.set('a', 'one'); cache.set('b', 'two'); expect(cache.get('a')).toBe('one');
    cache.set('c', 'three'); expect(cache.get('b')).toBeUndefined();
    cache.set('huge', 'x'.repeat(100)); expect(cache.get('huge')).toBeUndefined(); expect(cache.get('a')).toBe('one');
    cache.set('d', 'x'.repeat(35)); expect(cache.get('a')).toBeUndefined(); expect(cache.get('c')).toBeUndefined();
    now = 101; cache.prune(); expect(cache.get('d')).toBeUndefined();
    cache.set('e', 'next'); cache.clear(); expect(cache.get('e')).toBeUndefined();
  });
  it('serializes API calls, discards aborted queued work and reuses page information', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const fetcher = vi.fn().mockImplementation(async (id: string) => { await waiting; return [{ page: 0, original: originalUrl(id) }]; });
    const store = createPageStore(fetcher), a = new AbortController(), b = new AbortController(), c = new AbortController();
    const first = store.load('123', a.signal).catch(error => error);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const skipped = store.load('456', b.signal).catch(error => error); b.abort();
    const latest = store.load('789', c.signal); a.abort();
    expect(fetcher).toHaveBeenCalledTimes(1); finish();
    await first; await skipped; expect(await latest).toEqual([{ page: 0, original: originalUrl('789') }]);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['123', '789']);
    await store.load('789', c.signal); expect(fetcher).toHaveBeenCalledTimes(2);
    store.clear(); await store.load('789', c.signal); expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('respects Retry-After in both seconds and HTTP dates without automatic retries', async () => {
    const now = Date.now();
    expect(retryAfterMs('120', now)).toBe(120_000); expect(retryAfterMs(null, now)).toBe(60_000);
    expect(retryAfterMs(new Date(now + 180_000).toUTCString(), now)).toBeGreaterThan(179_000);
    const fetcher = vi.fn().mockRejectedValue(new RateLimitError('pixiv-pages-http-429', 120_000));
    const store = createPageStore(fetcher);
    await expect(store.load('123', new AbortController().signal)).rejects.toThrow('http-429');
    await expect(store.load('456', new AbortController().signal)).rejects.toThrow('http-429');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('page store: joined, detached and bounded requests (issue #14)', () => {
  const abortable = () => {
    const pending = new Map<string, { resolve: () => void; signal: AbortSignal }>();
    const fetcher = vi.fn((id: string, signal?: AbortSignal) => new Promise<{ page: number; original: string }[]>((resolve, reject) => {
      pending.set(id, { resolve: () => resolve([{ page: 0, original: originalUrl(id) }]), signal: signal! });
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    return { fetcher, pending };
  };
  it('joins requests for the same artwork and keeps a sent request alive into the cache when its caller leaves', async () => {
    const { fetcher, pending } = abortable(); const store = createPageStore(fetcher);
    const a = new AbortController(), b = new AbortController();
    const first = store.load('123', a.signal).catch(error => error), second = store.load('123', b.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    a.abort(); expect(await first).toBeInstanceOf(DOMException); expect(pending.get('123')!.signal.aborted).toBe(false);
    b.abort(); await expect(second).rejects.toThrow(); expect(pending.get('123')!.signal.aborted).toBe(false);
    pending.get('123')!.resolve(); await vi.waitFor(() => expect(store.peek('123')).toBeDefined());
    expect(await store.load('123', new AbortController().signal)).toEqual([{ page: 0, original: originalUrl('123') }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('keeps at most one detached request and never sends queued work for callers that left', async () => {
    const { fetcher, pending } = abortable(); const store = createPageStore(fetcher);
    const callers = ['1', '2', '3'].map(() => new AbortController());
    const one = store.load('1', callers[0]!.signal).catch(() => {});
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const queued = store.load('9', new AbortController().signal); // waits behind the wanted request
    const skipped = new AbortController(); const never = store.load('8', skipped.signal).catch(() => 'skipped');
    callers[0]!.abort(); await one;                                 // '1' detaches; queued '9' starts
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    skipped.abort(); expect(await never).toBe('skipped');
    const two = store.load('2', callers[1]!.signal).catch(() => {});
    pending.get('9')!.resolve(); await queued;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    callers[1]!.abort(); await two;                                 // '2' detaches -> older detached '1' is aborted
    expect(pending.get('1')!.signal.aborted).toBe(true); expect(pending.get('2')!.signal.aborted).toBe(false);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['1', '9', '2']);
  });
  it('clear() aborts everything and drops late results', async () => {
    const fetcher = vi.fn((_id: string, _signal?: AbortSignal) => new Promise<{ page: number; original: string }[]>(resolve => setTimeout(() => resolve([{ page: 0, original: originalUrl() }]), 5)));
    const store = createPageStore(fetcher); const caller = new AbortController();
    const loading = store.load('123', caller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    store.clear(); expect(fetcher.mock.calls[0]![1]!.aborted).toBe(true);
    await loading.catch(() => {}); await new Promise(resolve => setTimeout(resolve, 10));
    expect(store.peek('123')).toBeUndefined();
  });
});

describe('preview controls', () => {
  it('contains every edge placement and flips left when right space runs out', () => {
    const right = previewPosition({ left: 900, right: 1000, top: 700, bottom: 800 }, 440, 500, 1100, 850);
    expect(right).toEqual({ left: 448, top: 342 });
    expect(previewPosition({ left: 0, right: 100, top: -20, bottom: 80 }, 344, 620, 360, 640)).toEqual({ left: 8, top: 8 });
  });
  it('accumulates small deltas but consumes one page for a continuous trackpad gesture', () => {
    const wheel = new PageWheel(), steps: number[] = [];
    for (let i = 0; i < 100; i++) steps.push(wheel.step(10, 0, i * 16));
    expect(steps.filter(Boolean)).toEqual([1]);
    expect(wheel.step(-120, 0, 1900)).toBe(-1);
    expect(wheel.step(120, 0, 2000)).toBe(0);
    expect(wheel.step(120, 0, 2400)).toBe(1);
    wheel.reset(); expect(wheel.step(-5, 1, 2600)).toBe(-1);
    wheel.reset(); expect(wheel.step(1, 2, 3000)).toBe(1);
    expect(wheel.step(NaN, 0, 4000)).toBe(0);
  });
});
