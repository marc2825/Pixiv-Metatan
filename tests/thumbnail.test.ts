// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { thumbnailFromTarget } from '../src/pixiv/thumbnail';
import { originalUrl, previewUrl } from './fixtures';

const square = (id = '123') => `https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/10/22/00/00/00/${id}_p0_square1200.jpg`;
const custom = (id = '123') => `https://i.pximg.net/c/250x250_80_a2/custom-thumb/img/2026/10/22/00/00/00/${id}_p0_custom1200.jpg`;
function html(markup: string) { document.body.innerHTML = markup; return document.body; }
afterEach(() => { document.body.replaceChildren(); });

describe('thumbnail detection fixtures (synthetic pixiv-like DOM)', () => {
  it.each([square(), custom(), previewUrl(), 'https://i.pximg.net/c/360x360_70/img-master/img/2026/10/22/00/00/00/123_p0_square1200.jpg'])('detects nested hover targets for %s', url => {
    html(`<ul><li><div><a href="/artworks/123" title="T"><div><div><img src="${url}" alt="Title"></div><span id="t">badge</span></div></a><a href="/users/9"><img src="${square('9')}"></a><a href="/users/9">Author</a></div></li></ul>`);
    const found = thumbnailFromTarget(document.getElementById('t'));
    expect(found).toMatchObject({ artworkId: '123', image: url, title: 'Title', author: 'Author' });
  });
  it('skips non-pximg images inside the link and prefers the hovered image', () => {
    html(`<a href="/en/artworks/123"><img id="badge" src="https://s.pximg.net/www/images/badge.svg"><img id="second" src="${square()}"></a>`);
    expect(thumbnailFromTarget(document.getElementById('badge'))?.image).toBe(square());
    expect(thumbnailFromTarget(document.getElementById('second'))?.image).toBe(square());
  });
  it('uses currentSrc chosen from srcset, falling back to src', () => {
    html(`<a href="/artworks/123"><img id="i" src="https://s.pximg.net/transparent.gif" srcset="${square()} 1x"></a>`);
    const img = document.getElementById('i')! as HTMLImageElement;
    expect(thumbnailFromTarget(img)).toBeUndefined();
    Object.defineProperty(img, 'currentSrc', { configurable: true, value: square() });
    expect(thumbnailFromTarget(img)?.image).toBe(square());
  });
  it('waits for lazy images and rejects recycled cards whose image now belongs to another work', () => {
    html(`<a id="a" href="/artworks/123"><img id="i" src="https://s.pximg.net/www/images/common/transparent.gif" data-src="${square()}"></a>`);
    expect(thumbnailFromTarget(document.getElementById('a'))).toBeUndefined();
    (document.getElementById('i') as HTMLImageElement).src = square();
    expect(thumbnailFromTarget(document.getElementById('a'))?.artworkId).toBe('123');
    (document.getElementById('i') as HTMLImageElement).src = square('456');
    expect(thumbnailFromTarget(document.getElementById('a'))).toBeUndefined();
  });
  it('supports an overlay link whose card container holds the image, only with the same artwork ID', () => {
    html(`<div class="card"><div><img src="${square()}" alt="Overlay title"></div><a id="o" href="/artworks/123"></a></div>`);
    expect(thumbnailFromTarget(document.getElementById('o'))).toMatchObject({ artworkId: '123', title: 'Overlay title' });
    html(`<div class="card"><img src="${square('456')}"><a id="o" href="/artworks/123"></a></div>`);
    expect(thumbnailFromTarget(document.getElementById('o'))).toBeUndefined();
  });
  it('does not borrow an author from a neighbouring card without a list-item boundary', () => {
    html(`<div><div><a id="a" href="/artworks/123"><img src="${square()}"></a></div><div><a href="/users/5">Other author</a></div></div>`);
    expect(thumbnailFromTarget(document.getElementById('a'))?.author).toBeUndefined();
  });
  it('does not associate an image outside any artwork link by guessing', () => {
    html(`<div><img id="i" src="${square()}"><a href="/artworks/123">title</a></div>`);
    expect(thumbnailFromTarget(document.getElementById('i'))).toBeUndefined();
  });
  it.each([
    `<a id="x" href="/users/123"><img src="${square()}"></a>`,
    `<a id="x" href="/artworks/123/extra"><img src="${square()}"></a>`,
    `<a id="x" href="https://evil.example/artworks/123"><img src="${square()}"></a>`,
    `<a id="x" href="/artworks/123"><img src="${originalUrl()}"></a>`,
    `<a id="x" href="/artworks/123"><img src="${square().replace('i.pximg.net', 'i.pximg.net.evil')}"></a>`,
    `<a id="x" href="/artworks/123"><img src="${previewUrl('123', 1)}"></a>`,
  ])('rejects non-artwork, foreign or non-thumbnail markup %#', markup => {
    html(markup); expect(thumbnailFromTarget(document.getElementById('x'))).toBeUndefined();
  });
  it('bounds candidates and label lengths', () => {
    const many = Array.from({ length: 9 }, () => '<img src="https://s.pximg.net/x.png">').join('');
    html(`<a id="a" href="/artworks/123">${many}<img src="${square()}"></a>`);
    expect(thumbnailFromTarget(document.getElementById('a'))).toBeUndefined();
    html(`<li><a id="a" href="/artworks/123"><img src="${square()}" alt="${'t'.repeat(400)}"></a><a href="/users/1">${'n'.repeat(400)}</a></li>`);
    const found = thumbnailFromTarget(document.getElementById('a'))!;
    expect(found.title).toHaveLength(300); expect(found.author).toHaveLength(160);
  });
  it.each(['javascript:alert(1)//artworks/123', 'data:text/html,<a href=/artworks/123>', 'blob:https://www.pixiv.net/artworks/123'])('ignores non-https artwork-looking links %s', href => {
    const anchor = document.createElement('a'); anchor.id = 'x'; anchor.setAttribute('href', href);
    const img = document.createElement('img'); img.src = square(); anchor.append(img); document.body.append(anchor);
    expect(thumbnailFromTarget(document.getElementById('x'))).toBeUndefined();
  });
  it('accepts a card captured with the MANUAL_TESTS sanitizing snippet (issue #11 workflow)', () => {
    // Exact output of the docs/MANUAL_TESTS.md snippet for a synthetic card (IDs/dates replaced, no text).
    html('<ul><li><div data-gtm-value=""><a href="/artworks/123"><img src="https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/10/22/00/00/00/123_p0_square1200.jpg"></a><a href="/users/123"></a><img src="https://example.invalid/common/images/no_profile.png"></div></li></ul>');
    expect(thumbnailFromTarget(document.querySelector('a[href="/artworks/123"] img'))).toMatchObject({ artworkId: '123', title: undefined, author: undefined });
  });
});
