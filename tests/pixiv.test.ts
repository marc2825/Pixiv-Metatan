import { afterEach, describe, expect, it, vi } from 'vitest';
import { artworkIdFromUrl, classifyOriginal, getArtworkPages, parseArtworkPages, pixivMessage, validatePixivImageUrl, validatePreviewUrl } from '../src/pixiv/artworks';
import type { InspectionError } from '../src/limits';
import { accessExplanation } from '../src/network/failures';
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

describe('page listing robustness and precise pixiv errors', () => {
  // URL shapes observed from the live pages API on 2026-11-19 (artwork ID/date replaced).
  const live = {
    thumb_mini: 'https://i.pximg.net/c/128x128/img-master/img/2026/10/22/00/00/00/123_p0_square1200.jpg',
    small: 'https://i.pximg.net/c/540x540_70/img-master/img/2026/10/22/00/00/00/123_p0_master1200.jpg',
    regular: 'https://i.pximg.net/img-master/img/2026/10/22/00/00/00/123_p0_master1200.jpg',
    original: 'https://i.pximg.net/img-original/img/2026/10/22/00/00/00/123_p0.jpg',
  };
  it('accepts every URL shape observed from the live API and keeps small/regular for srcset', () => {
    for (const url of [live.thumb_mini, live.small, live.regular]) expect(validatePreviewUrl(url, '123', 0)).toBe(url);
    expect(parseArtworkPages({ error: false, message: '', body: [{ urls: live, width: 1, height: 1 }] }, '123'))
      .toEqual([{ page: 0, original: live.original, preview: live.regular, previewSmall: live.small }]);
  });
  it('keeps numbering but marks unrecognised original shapes non-inspectable', () => {
    const payload = pagePayload('123', 3);
    payload.body[1]!.urls.original = originalUrl('123', 1, 'gif');
    payload.body[2]!.urls.original = 'https://i.pximg.net/img-original/img/2026/10/22/00/00/00/123_ugoira0.jpg';
    expect(parseArtworkPages(payload, '123')).toEqual([
      { page: 0, original: originalUrl() },
      { page: 1, unavailable: 'unsupported-original-format' },
      { page: 2, unavailable: 'unrecognized-original-url' },
    ]);
    expect(classifyOriginal(originalUrl('123', 1, 'gif'), '123', 1)).toEqual({ unavailable: 'unsupported-original-format' });
  });
  it.each([originalUrl('999', 0, 'gif'), originalUrl('123', 1, 'gif'), 'https://evil.example/img-original/x.png', originalUrl().replace('https:', 'http:')])('still rejects the whole listing for mismatched or foreign original %s', url => {
    const payload = pagePayload('123', 1); payload.body[0]!.urls.original = url;
    expect(() => parseArtworkPages(payload, '123')).toThrow();
  });
  it('the worker validator remains strict for non-inspectable shapes', () => {
    expect(() => validatePixivImageUrl(originalUrl('123', 0, 'gif'), '123', 0)).toThrow('image-artwork-mismatch');
  });
  it('reports pixiv error payloads with sanitized, bounded server text', async () => {
    const message = `該当作品は削除されたか、存在しない作品IDです。\u0000<script>${'x'.repeat(400)}`;
    expect(() => parseArtworkPages({ error: true, message, body: [] }, '123')).toThrow('pixiv-pages-error');
    try { parseArtworkPages({ error: true, message, body: [] }, '123'); } catch (error) {
      const detail = (error as InspectionError).detail!;
      expect(detail.length).toBeLessThanOrEqual(200); expect(detail).not.toContain('\u0000'); expect(detail).toContain('<script>');
    }
    expect(pixivMessage(42)).toBeUndefined(); expect(pixivMessage('  ')).toBeUndefined();
  });
  it('reads a small JSON body for 4xx but never for 429 or HTML', async () => {
    const json = (status: number) => new Response(JSON.stringify({ error: true, message: 'not found' }), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    await expect(getArtworkPages('123', undefined, vi.fn<typeof fetch>().mockResolvedValue(json(404)))).rejects.toMatchObject({ code: 'pixiv-pages-http-404', detail: 'not found' });
    await expect(getArtworkPages('123', undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 403, headers: { 'content-type': 'text/html' } })))).rejects.toMatchObject({ code: 'pixiv-pages-http-403', detail: undefined });
    await expect(getArtworkPages('123', undefined, vi.fn<typeof fetch>().mockResolvedValue(json(429)))).rejects.toMatchObject({ code: 'pixiv-pages-http-429', detail: undefined });
    const big = new Response('{"message":"' + 'x'.repeat(70_000) + '"}', { status: 400, headers: { 'content-type': 'application/json' } });
    await expect(getArtworkPages('123', undefined, vi.fn<typeof fetch>().mockResolvedValue(big))).rejects.toMatchObject({ code: 'pixiv-pages-http-400', detail: undefined });
  });
  it('explains each failing layer from evidence without claiming certainty', () => {
    expect(accessExplanation('http-403', 'original')).toContain('画像配信サーバーが拒否しました');
    expect(accessExplanation('http-403', 'original')).toContain('Cookieは送りません');
    expect(accessExplanation('http-403', 'original')).toContain('この応答だけでは特定できません');
    expect(accessExplanation('pixiv-pages-http-403', 'pages')).toContain('この応答だけでは特定できません');
    expect(accessExplanation('pixiv-pages-http-404', 'pages', '削除')).toContain('pixivの応答:「削除」');
    expect(accessExplanation('http-503', 'original')).toContain('サーバー側のエラー');
    expect(accessExplanation('pixiv-pages-timeout', 'pages')).toContain('タイムアウト');
  });
});

describe('URL canonicalisation attacks (no SSRF-style escape from the allowlist)', () => {
  const tricks = (url: string) => [
    url.replace('i.pximg.net', 'I.PXIMG.NET'), url.replace('i.pximg.net', 'i.pximg.net.'), url.replace('i.pximg.net', 'i．pximg．net'),
    url.replace('https://', 'https:\\\\'), url.replace('https://i.pximg.net/', 'https://i.pximg.net//'), url.replace('/img/', '/img%2F'),
    url.replace('123_p0', '12\t3_p0'), url.replace('123_p0', '12\n3_p0'), url.replace('https://i.pximg.net', 'https://i.pximg.net@evil.example'),
    url.replace('https://i.pximg.net', 'https://evil.example#i.pximg.net'), url.replace('https://i.pximg.net', 'https://[::1]'), url.replace('https://i.pximg.net', 'https://127.0.0.1'),
    url.replace('https://i.pximg.net', 'blob:https://i.pximg.net'), url.replace('https://i.pximg.net', 'filesystem:https://i.pximg.net'), ` ${url}`, `${url} `,
  ];
  it.each(tricks(originalUrl()))('worker original validator rejects %j', url => expect(() => validatePixivImageUrl(url, '123', 0)).toThrow());
  it.each(tricks(previewUrl()))('display validator rejects %j', url => expect(() => validatePreviewUrl(url, '123', 0)).toThrow());
  it.each(['javascript:alert(1)//www.pixiv.net/artworks/123', 'https://www.pixiv.net@evil.example/artworks/123', 'https://evil.example/https://www.pixiv.net/artworks/123', 'https://www.pixiv.net.evil.example/artworks/123', 'https://www.pixiv.net:8443/artworks/123'])('artwork links cannot be spoofed: %s', url => {
    expect(artworkIdFromUrl(url)).toBeNull();
  });
  it('never builds a request URL from anything but a validated numeric ID', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const id of ['../1', '1/../../x', '1?x=1', '01', '1e3', ' 1', '123456789012345678901']) await expect(getArtworkPages(id, undefined, fetcher)).rejects.toThrow('invalid-artwork-id');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
