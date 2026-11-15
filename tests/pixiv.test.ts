import { afterEach, describe, expect, it, vi } from 'vitest';
import { artworkIdFromUrl, getArtworkPages, parseArtworkPages, validatePixivImageUrl, validatePreviewUrl } from '../src/pixiv/artworks';
import { originalUrl, pagePayload, previewUrl } from './fixtures';

afterEach(() => vi.restoreAllMocks());

describe('pixiv page and authoritative originals', () => {
  it.each(['https://www.pixiv.net/artworks/123', 'https://www.pixiv.net/en/artworks/123?x=1#x', 'https://www.pixiv.net/artworks/123/'])('accepts artwork URL %s', url => expect(artworkIdFromUrl(url)).toBe('123'));
  it.each(['invalid', 'http://www.pixiv.net/artworks/123', 'https://pixiv.net/artworks/123', 'https://www.pixiv.net.evil/artworks/123', 'https://user@www.pixiv.net/artworks/123', 'https://www.pixiv.net:444/artworks/123', 'https://www.pixiv.net/artworks/123junk', 'https://www.pixiv.net/artworks/123/extra', 'https://www.pixiv.net/users/123', 'https://www.pixiv.net/artworks/0'])('rejects non-artwork %s', url => expect(artworkIdFromUrl(url)).toBeNull());
  it('validates 1 and multiple pages in exact order without reconstruction', () => {
    expect(parseArtworkPages(pagePayload('123', 1), '123')).toEqual([{ page: 0, original: originalUrl() }]);
    expect(parseArtworkPages(pagePayload('123', 10), '123').map(p => p.page)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it.each(['png', 'jpg', 'jpeg', 'webp'])('permits authoritative %s originals', ext => expect(validatePixivImageUrl(originalUrl('123', 1, ext), '123', 1)).toBe(originalUrl('123', 1, ext)));
  it.each([
    'https://evil.example/img-original/123_p0.png', originalUrl().replace('i.pximg.net', 'i.pximg.net.evil'), originalUrl().replace('https:', 'http:'),
    originalUrl().replace('i.pximg.net', 'user@i.pximg.net'), originalUrl().replace('i.pximg.net', 'i.pximg.net:444'), originalUrl().replace('i.pximg.net', 'i.pximg.net:443'),
    originalUrl() + '?x=1', originalUrl() + '#x', originalUrl('999'), originalUrl('123', 1), originalUrl().replace('img-original', 'img-master'),
    originalUrl().replace('123_p0', '123_p00'), originalUrl().replace('123_p0', '%31%32%33_p0'), originalUrl().replace('123_p0', '123_p0_master1200'), originalUrl().replace('123_p0', '../123_p0'),
    'https://i.pximg.net/img-original/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
  ])('denies forged image URL %s', url => expect(() => validatePixivImageUrl(url, '123', 0)).toThrow());
  it('rejects malformed schemas instead of skipping pages', () => {
    const bad: unknown[] = [null, [], {}, { error: true, body: [] }, { error: false, body: [] }, { body: pagePayload().body }, { error: false, body: [null] }, { error: false, body: [...pagePayload('123', 1).body, { urls: {} }] }, { error: false, body: pagePayload('123', 2).body.reverse() }];
    for (const payload of bad) expect(() => parseArtworkPages(payload, '123')).toThrow();
    expect(() => parseArtworkPages(pagePayload('123', 1001), '123')).toThrow();
  });
  it('keeps authoritative derivatives separate from originals in exact page order', () => {
    expect(parseArtworkPages(pagePayload('123', 2, true), '123')).toEqual([
      { page: 0, original: originalUrl(), preview: previewUrl() },
      { page: 1, original: originalUrl('123', 1), preview: previewUrl('123', 1) },
    ]);
    const payload = pagePayload('123', 2, true); payload.body[1]!.urls.regular = previewUrl('999', 0);
    const parsed = parseArtworkPages(payload, '123');
    expect(parsed[1]).toEqual({ page: 1, original: originalUrl('123', 1) });
  });
  it.each([originalUrl(), previewUrl('999'), previewUrl('123', 1), previewUrl() + '?token=x', previewUrl().replace('https:', 'http:'), previewUrl().replace('i.pximg.net', 'i.pximg.net.evil'), previewUrl().replace('i.pximg.net', 'user@i.pximg.net'), 'data:image/png;base64,x', 'javascript:alert(1)'])('rejects invalid display derivative %s', url => {
    expect(() => validatePreviewUrl(url, '123', 0)).toThrow();
  });
  it('accepts ordinary sized thumbnails without changing the supplied URL', () => {
    const thumbnail = previewUrl().replace('/img-master/', '/c/250x250_80_a2/img-master/');
    expect(validatePreviewUrl(thumbnail, '123', 0)).toBe(thumbnail);
  });
  it('uses bounded same-origin authenticated data without following redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(pagePayload()));
    expect(await getArtworkPages('123', undefined, fetcher)).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://www.pixiv.net/ajax/illust/123/pages', expect.objectContaining({ credentials: 'same-origin', redirect: 'error', signal: expect.any(AbortSignal) }));
  });
  it.each([401, 403, 404, 429])('reports artwork data HTTP %d without retry', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('denied', { status }));
    await expect(getArtworkPages('123', undefined, fetcher)).rejects.toThrow(`http-${status}`); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects HTML and oversized JSON', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }));
    await expect(getArtworkPages('123', undefined, fetcher)).rejects.toThrow('content-type');
    fetcher.mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }));
    await expect(getArtworkPages('123', undefined, fetcher)).rejects.toThrow('too-large');
  });
  it('identifies API timeouts separately from HTTP denial and cancellation', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timeout', 'TimeoutError')));
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { init?.signal?.throwIfAborted(); return Response.json(pagePayload()); });
    await expect(getArtworkPages('123', undefined, fetcher)).rejects.toThrow('pixiv-pages-timeout');
    const cancelled = new AbortController(); cancelled.abort();
    await expect(getArtworkPages('123', cancelled.signal, fetcher)).rejects.not.toThrow('pixiv-pages-timeout');
  });
});
