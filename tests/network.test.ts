import { describe, expect, it, vi } from 'vitest';
import { InspectionError, MAX_IMAGE_BYTES, readBounded } from '../src/limits';
import { createInspector, type InspectRequest, type Sender } from '../src/network/inspector';
import { originalUrl, pngWithText, png } from './fixtures';

const sender: Sender = { id: 'extension', frameId: 0, url: 'https://www.pixiv.net/artworks/123', tab: { id: 7 } };
const request: InspectRequest = { type: 'INSPECT_PIXIV_IMAGE', requestId: 'test-1', artworkId: '123', page: 0, url: originalUrl() };
function setup(fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(pngWithText({ Software: 'NovelAI' }), { headers: { 'content-type': 'image/png' } })), timeoutMs = 15_000) {
  const tabUrl = vi.fn().mockResolvedValue(sender.url);
  return { ...createInspector({ extensionId: 'extension', fetcher, tabUrl, timeoutMs }), fetcher, tabUrl };
}
function waitingFetch() {
  return vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
  }));
}

describe('bounded streams', () => {
  it('rejects at the actual byte limit and cancels the source', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(8)); c.enqueue(new Uint8Array(8)); }, cancel });
    await expect(readBounded(stream, 10)).rejects.toThrow('too-large'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels a stalled reader on abort', async () => {
    const cancel = vi.fn(), abort = new AbortController();
    const reading = readBounded(new ReadableStream({ cancel }), 100, abort.signal);
    abort.abort(); await expect(reading).rejects.toThrow(); expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('privileged worker boundary', () => {
  it('makes no request until Inspect, omits credentials, and returns normalized data only', async () => {
    const worker = setup(); expect(worker.fetcher).not.toHaveBeenCalled();
    const result = await worker.handle(request, sender);
    expect(result?.generator).toBe('novelai'); expect(result?.source).toEqual({ kind: 'pixiv', artworkId: '123', page: 0, url: originalUrl() });
    expect(worker.fetcher).toHaveBeenCalledExactlyOnceWith(originalUrl(), { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal) });
  });
  it.each([
    {}, { ...sender, id: 'attacker' }, { ...sender, frameId: 1 }, { ...sender, tab: undefined }, { ...sender, tab: { id: -1 } },
    { ...sender, url: 'https://evil.example/artworks/123' }, { ...sender, url: 'https://www.pixiv.net.evil/artworks/123' },
  ])('rejects untrusted sender %j before fetching', async untrusted => {
    const worker = setup(); expect((await worker.handle(request, untrusted))?.status).toBe('access-denied'); expect(worker.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ...request, url: 'https://evil.example/file.png' }, { ...request, url: originalUrl('999') }, { ...request, url: originalUrl('123', 1) },
    { ...request, page: -1 }, { ...request, page: 0.5 }, { ...request, artworkId: '123junk' }, { ...request, requestId: null }, { type: 'INSPECT_PIXIV_IMAGE' },
  ])('rejects malformed requests %j without fetching', async bad => {
    const worker = setup(); expect((await worker.handle(bad, sender))?.status).toBe('access-denied'); expect(worker.fetcher).not.toHaveBeenCalled();
  });
  it('ignores unrelated messages', () => { const worker = setup(); expect(worker.handle({ type: 'FETCH_URL', url: originalUrl() }, sender)).toBeUndefined(); expect(worker.fetcher).not.toHaveBeenCalled(); });
  it('checks live tab rather than stale sender.tab or sender.url', async () => {
    const worker = setup(); worker.tabUrl.mockResolvedValue('https://www.pixiv.net/artworks/456');
    expect((await worker.handle(request, sender))?.status).toBe('access-denied'); expect(worker.fetcher).not.toHaveBeenCalled();
    worker.tabUrl.mockResolvedValue(sender.url);
    expect((await worker.handle(request, { ...sender, url: 'https://www.pixiv.net/' }))?.status).toBe('found');
  });
  it('does not return results if the tab navigates while reading', async () => {
    const worker = setup(); worker.tabUrl.mockResolvedValueOnce(sender.url).mockResolvedValue('https://www.pixiv.net/artworks/456');
    expect((await worker.handle(request, sender))?.status).toBe('access-denied');
  });
  it.each(['/tags/test/artworks', '/ranking.php?mode=daily', '/users/456', '/users/456/bookmarks/artworks', '/bookmark_new_illust.php', '/artworks/999'])('authorizes an explicit thumbnail inspection in exact pixiv context %s', async path => {
    const worker = setup(), contextUrl = `https://www.pixiv.net${path}`;
    worker.tabUrl.mockResolvedValue(contextUrl);
    expect((await worker.handle({ ...request, contextUrl }, sender))?.status).toBe('found');
    expect(worker.fetcher).toHaveBeenCalledOnce();
  });
  it.each(['https://evil.example/', 'https://www.pixiv.net.evil/', 'https://user@www.pixiv.net/', 'javascript:alert(1)', 42, null])('denies invalid operation context %j', async contextUrl => {
    const worker = setup();
    expect((await worker.handle({ ...request, contextUrl }, sender))?.status).toBe('access-denied');
    expect(worker.fetcher).not.toHaveBeenCalled();
  });
  it('binds list inspections to the exact live tab URL before and after fetch', async () => {
    const contextUrl = 'https://www.pixiv.net/tags/test/artworks?order=date';
    const worker = setup(); worker.tabUrl.mockResolvedValue(contextUrl + '_d');
    expect((await worker.handle({ ...request, contextUrl }, sender))?.status).toBe('access-denied');
    expect(worker.fetcher).not.toHaveBeenCalled();
    worker.tabUrl.mockResolvedValueOnce(contextUrl).mockResolvedValue('https://www.pixiv.net/users/456');
    expect((await worker.handle({ ...request, contextUrl }, sender))?.status).toBe('access-denied');
    expect(worker.fetcher).toHaveBeenCalledOnce();
  });
  it('does not allow legacy requests from non-artwork tabs', async () => {
    const worker = setup(); worker.tabUrl.mockResolvedValue('https://www.pixiv.net/ranking.php');
    expect((await worker.handle(request, sender))?.status).toBe('access-denied'); expect(worker.fetcher).not.toHaveBeenCalled();
  });
  it('cancels a list-context request on query-only SPA changes', async () => {
    const contextUrl = 'https://www.pixiv.net/tags/test/artworks?q=one';
    const worker = setup(waitingFetch()); worker.tabUrl.mockResolvedValue(contextUrl);
    const pending = worker.handle({ ...request, contextUrl }, sender);
    await vi.waitFor(() => expect(worker.fetcher).toHaveBeenCalledOnce());
    worker.onNavigation(7, contextUrl.replace('one', 'two'));
    expect((await pending)?.status).toBe('cancelled');
  });
  it('honors 429 cooldown without a second original fetch', async () => {
    const worker = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '120' } })));
    expect((await worker.handle(request, sender))?.notes.join(' ')).toContain('http-429');
    expect((await worker.handle({ ...request, requestId: 'again' }, sender))?.notes.join(' ')).toContain('http-429');
    expect(worker.fetcher).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 404, 429, 500])('reports HTTP %d and local fallback without retries', async status => {
    const worker = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status })));
    const result = await worker.handle(request, sender);
    expect(result?.status).toBe('access-denied'); expect(result?.notes.join(' ')).toContain(`http-${status}`); expect(result?.notes.join(' ')).toContain('ローカル'); expect(worker.fetcher).toHaveBeenCalledOnce();
  });
  it.each(['text/html', 'application/json', 'application/octet-stream', ''])('rejects unexpected MIME %s', async mime => {
    const worker = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(png(), { headers: { 'content-type': mime } })));
    expect((await worker.handle(request, sender))?.notes[0]).toContain('unexpected-content-type');
  });
  it('rejects mismatched MIME versus magic but identifies server-side JPEG conversion', async () => {
    const jpeg = new Uint8Array([255, 216, 255, 224]);
    const worker = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(jpeg, { headers: { 'content-type': 'image/png' } })));
    expect((await worker.handle(request, sender))?.notes[0]).toContain('content-type-mismatch');
    const converted = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } })));
    const result = await converted.handle(request, sender); expect(result?.format).toBe('jpeg'); expect(result?.status).toBe('unsupported-format');
  });
  it('rejects redirects and network errors without retrying', async () => {
    const worker = setup(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await worker.handle(request, sender))?.status).toBe('access-denied'); expect(worker.fetcher).toHaveBeenCalledOnce();
    const response = new Response(png(), { headers: { 'content-type': 'image/png' } }); Object.defineProperty(response, 'redirected', { value: true });
    const redirected = setup(vi.fn<typeof fetch>().mockResolvedValue(response));
    expect((await redirected.handle(request, sender))?.notes[0]).toContain('redirect-denied');
  });
  it.each([undefined, '1', String(MAX_IMAGE_BYTES + 1)])('bounds response streams with Content-Length=%s', async length => {
    let produced = 0; const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)); produced++; }, cancel });
    const headers: Record<string, string> = { 'content-type': 'image/png' }; if (length) headers['content-length'] = length;
    const worker = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, { headers })));
    expect((await worker.handle(request, sender))?.status).toBe('too-large'); expect(produced).toBeLessThanOrEqual(50); expect(cancel).toHaveBeenCalledOnce();
  });
  it('holds one global slot across tabs, double clicks and cancelling until settled', async () => {
    const fetcher = waitingFetch(), worker = setup(fetcher);
    const first = worker.handle(request, sender);
    expect((await worker.handle({ ...request, requestId: 'test-2' }, { ...sender, tab: { id: 8 } }))?.status).toBe('busy');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await worker.handle({ type: 'CANCEL_INSPECTION', requestId: request.requestId }, { ...sender, tab: { id: 8 } });
    expect((fetcher.mock.calls[0]?.[1]?.signal)?.aborted).toBe(false);
    const cancellation = worker.handle({ type: 'CANCEL_INSPECTION', requestId: request.requestId }, sender);
    expect((await worker.handle({ ...request, requestId: 'test-3' }, sender))?.status).toBe('busy');
    await cancellation; expect((await first)?.status).toBe('cancelled');
    fetcher.mockResolvedValue(new Response(png(), { headers: { 'content-type': 'image/png' } }));
    expect((await worker.handle({ ...request, requestId: 'test-4' }, sender))?.status).toBe('no-metadata');
  });
  it('ignores cancellation of a different request and cancels on navigation/removal', async () => {
    const fetcher = waitingFetch(), worker = setup(fetcher); const first = worker.handle(request, sender);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    await worker.handle({ type: 'CANCEL_INSPECTION', requestId: 'other' }, sender);
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    worker.onNavigation(8); expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    worker.onNavigation(7, 'https://www.pixiv.net/artworks/456'); expect((await first)?.status).toBe('cancelled');
  });
  it('times out and releases the slot', async () => {
    const fetcher = waitingFetch(), worker = setup(fetcher, 20);
    expect((await worker.handle(request, sender))?.notes[0]).toContain('タイムアウト');
    fetcher.mockRejectedValue(new InspectionError('http-403'));
    expect((await worker.handle(request, sender))?.notes[0]).toContain('http-403');
  });
});
