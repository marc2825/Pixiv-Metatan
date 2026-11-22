// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInspector, type AppDependencies } from '../src/ui/app';
import { SWEEP_API_DELAY_MS } from '../src/ui/preview';
import { emptyResult, type InspectionResult } from '../src/metadata/types';
import { InspectionError } from '../src/limits';
import { RateLimitError } from '../src/network/failures';
import { originalUrl, previewUrl } from './fixtures';

let root: ShadowRoot, destroy: () => void;
const attach = Element.prototype.attachShadow;
const list = (id = '123', count = 3) => Array.from({ length: count }, (_, page) => ({ page, original: originalUrl(id, page), preview: previewUrl(id, page) }));
function card(id = '123') {
  const anchor = document.createElement('a'); anchor.href = `/artworks/${id}`;
  const img = document.createElement('img'); img.src = previewUrl(id).replace('/img-master/', '/c/250x250_80_a2/img-master/'); img.alt = `Artwork ${id}`;
  anchor.append(img); document.body.append(anchor); return anchor;
}
function mount(overrides: Partial<AppDependencies> = {}) {
  const deps = { send: vi.fn().mockResolvedValue(emptyResult('found', ['synthetic result'])), pages: vi.fn().mockImplementation(async (id: string) => list(id)), ...overrides };
  destroy = mountInspector(deps); return deps;
}
const panel = () => root.querySelector<HTMLElement>('#pami-preview')!;
const control = (selector: string) => panel().querySelector<HTMLButtonElement>(selector)!;
const enter = (anchor: HTMLAnchorElement) => anchor.querySelector('img')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const leave = (anchor: HTMLAnchorElement, relatedTarget: EventTarget | null = null) => anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }));
async function open(anchor: HTMLAnchorElement) { enter(anchor); await vi.advanceTimersByTimeAsync(250); }

beforeEach(() => {
  vi.useFakeTimers(); history.replaceState({}, '', '/tags/synthetic/artworks');
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { root = attach.call(this, init); return root; });
});
afterEach(() => { destroy?.(); vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('delegated hover preview', () => {
  it('delays hover, supports lazy thumbnails, and fetches no original until Metadata', async () => {
    const deps = mount(); const anchor = card(); enter(anchor);
    await vi.advanceTimersByTimeAsync(249); expect(deps.pages).not.toHaveBeenCalled(); expect(panel().hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1); expect(deps.pages).toHaveBeenCalledOnce(); expect(deps.send).not.toHaveBeenCalled();
    expect(panel().hidden).toBe(false); expect(panel().querySelector('img')?.src).toBe(previewUrl());
    expect(control('.hover-counter').textContent).toBe('1 / 3');
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    expect(deps.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ artworkId: '123', page: 0, url: originalUrl(), contextUrl: location.href }));
    expect(panel().textContent).toContain('synthetic result');
  });
  it('cancels transient hover and allows moving from thumbnail into preview', async () => {
    const deps = mount(), anchor = card(); enter(anchor); leave(anchor);
    await vi.advanceTimersByTimeAsync(300); expect(deps.pages).not.toHaveBeenCalled();
    await open(anchor); leave(anchor, root.host); panel().dispatchEvent(new MouseEvent('mouseenter'));
    await vi.advanceTimersByTimeAsync(500); expect(panel().hidden).toBe(false);
    panel().dispatchEvent(new MouseEvent('mouseleave')); await vi.advanceTimersByTimeAsync(199); expect(panel().hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(panel().hidden).toBe(true);
    await open(anchor); expect(deps.pages).toHaveBeenCalledOnce();
  });
  it('discards slow API responses when hover switches rapidly', async () => {
    let resolve!: (value: ReturnType<typeof list>) => void;
    const pending = new Promise<ReturnType<typeof list>>(r => { resolve = r; });
    const pages = vi.fn().mockReturnValueOnce(pending).mockImplementation(async (id: string) => list(id, 2));
    const deps = mount({ pages }), a = card('123'), b = card('456');
    await open(a); leave(a); await open(b); expect(pages).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('h2')?.textContent).toBe('Artwork 456');
    // B opened during a sweep: its request waits SWEEP_API_DELAY_MS (issue #14); A's sent request keeps running.
    await vi.advanceTimersByTimeAsync(SWEEP_API_DELAY_MS); expect(pages).toHaveBeenCalledTimes(2);
    expect(control('.hover-counter').textContent).toBe('1 / 2');
    resolve(list()); await vi.advanceTimersByTimeAsync(0);
    // The late response for A never reaches B's preview...
    expect(panel().querySelector('img')?.src).toBe(previewUrl('456'));
    expect(control('.hover-counter').textContent).toBe('1 / 2'); expect(deps.send).not.toHaveBeenCalled();
    // ...but it is cached, so returning to A needs no second request.
    leave(b); await vi.advanceTimersByTimeAsync(300); await open(a);
    expect(pages).toHaveBeenCalledTimes(2); expect(control('.hover-counter').textContent).toBe('1 / 3');
  });
  it('keeps page boundaries, consumes a continuous wheel gesture once, and supports arrows/buttons', async () => {
    const deps = mount(), anchor = card(); await open(anchor);
    const stage = control('.preview-stage');
    for (let i = 0; i < 40; i++) { const event = new WheelEvent('wheel', { deltaY: 10, cancelable: true }); stage.dispatchEvent(event); expect(event.defaultPrevented).toBe(true); await vi.advanceTimersByTimeAsync(16); }
    expect(control('.hover-counter').textContent).toBe('2 / 3'); expect(panel().querySelector('img')?.src).toBe(previewUrl('123', 1));
    control('.hover-next').click(); expect(control('.hover-counter').textContent).toBe('3 / 3'); expect(control('.hover-next').disabled).toBe(true);
    stage.focus(); stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, composed: true }));
    expect(control('.hover-counter').textContent).toBe('2 / 3');
    control('.hover-previous').click(); expect(control('.hover-previous').disabled).toBe(true);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('simplifies a single-page work and does not suppress its wheel or native link click', async () => {
    mount({ pages: vi.fn().mockResolvedValue(list('123', 1)) }); const anchor = card(); await open(anchor);
    expect(control('.hover-next').hidden).toBe(true); expect(control('.hover-previous').hidden).toBe(true);
    const wheel = new WheelEvent('wheel', { deltaY: 100, cancelable: true }); control('.preview-stage').dispatchEvent(wheel); expect(wheel.defaultPrevented).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.addEventListener('click', event => { expect(event.defaultPrevented).toBe(false); event.preventDefault(); }); anchor.dispatchEvent(click);
  });
  it('keeps preview after API denial and original 403 and never substitutes original for a derivative', async () => {
    const deps = mount({ send: vi.fn().mockResolvedValue(emptyResult('access-denied', ['http-403', 'ローカル'])) }); await open(card());
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    expect(panel().querySelector('img')?.src).toBe(previewUrl()); expect(panel().textContent).toContain('http-403');
    expect(control('.hover-local').disabled).toBe(false); expect(deps.send).toHaveBeenCalledOnce();
    destroy();
    mount({ pages: vi.fn().mockRejectedValue(new InspectionError('pixiv-pages-http-403')) }); const anchor = card('456'); await open(anchor);
    expect(panel().textContent).toContain('作品の画像一覧（pixiv API）'); expect(panel().textContent).toContain('pixiv-pages-http-403');
    expect(panel().querySelector('img')?.src).toContain('456_p0');
    expect(control('.hover-metadata').disabled).toBe(true); expect(control('.hover-local').disabled).toBe(false);
  });
  it.each([false, true])('shares page information and API rate limits with the artwork panel (limited=%s)', async limited => {
    history.replaceState({}, '', '/artworks/123');
    const pages = limited ? vi.fn().mockRejectedValue(new RateLimitError('pixiv-pages-http-429', 120_000)) : vi.fn().mockResolvedValue(list());
    mount({ pages }); await open(card());
    root.querySelector<HTMLButtonElement>('.toggle')!.click(); await vi.advanceTimersByTimeAsync(0);
    expect(pages).toHaveBeenCalledOnce();
    expect(root.querySelector<HTMLButtonElement>('#pami-panel .buttons > button')!.disabled).toBe(limited);
    if (limited) expect(root.querySelector('#pami-panel')?.textContent).toContain('pixiv-pages-http-429');
  });
  it('reuses per-page results and never automatically inspects when changing pages', async () => {
    const deps = mount(); await open(card()); control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    control('.hover-next').click(); expect(panel().querySelector('.hover-results')?.textContent).toBe(''); expect(deps.send).toHaveBeenCalledOnce();
    control('.hover-previous').click(); expect(panel().textContent).toContain('synthetic result');
    control('.hover-metadata').click(); expect(deps.send).toHaveBeenCalledOnce();
  });
  it('cancels page-specific inspection and ignores late results', async () => {
    let finish!: (result: InspectionResult) => void;
    const deps = mount({ send: vi.fn().mockReturnValue(new Promise<InspectionResult>(r => { finish = r; })) }); await open(card());
    control('.hover-metadata').click(); control('.hover-next').click();
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INSPECTION' }));
    finish(emptyResult('found', ['STALE PAGE ZERO'])); await vi.advanceTimersByTimeAsync(0);
    expect(panel().textContent).not.toContain('STALE PAGE ZERO'); expect(control('.hover-metadata').disabled).toBe(false);
  });
  it('closes on Escape with focus return and does not immediately reopen', async () => {
    const deps = mount(), anchor = card(); await open(anchor); control('.preview-stage').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true); expect(document.activeElement).toBe(anchor);
    await vi.advanceTimersByTimeAsync(500); expect(panel().hidden).toBe(true); expect(deps.pages).toHaveBeenCalledOnce();
  });
  it('lets keyboard users enter the preview from the focused artwork link', async () => {
    mount(); const anchor = card(); anchor.focus(); await vi.advanceTimersByTimeAsync(250);
    expect(panel().hidden).toBe(false);
    anchor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(root.activeElement).toBe(control('.preview-stage'));
    control('.preview-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
    expect(control('.hover-counter').textContent).toBe('2 / 3');
  });
  it('keeps prompt text navigation available and copies prompts only on an explicit click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mount({ send: vi.fn().mockResolvedValue({ ...emptyResult('found', []), fields: { prompt: 'line 1\nline 2' } }) });
    await open(card()); control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    const pre = panel().querySelector('pre')!; pre.focus();
    pre.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
    expect(control('.hover-counter').textContent).toBe('1 / 3'); expect(writeText).not.toHaveBeenCalled();
    const copy = [...panel().querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Promptをコピー')!;
    copy.click(); expect(writeText).toHaveBeenCalledWith('line 1\nline 2');
  });
  it('does not assign local metadata to the artwork result cache', async () => {
    const deps = mount(); await open(card()); control('.hover-local').click();
    const input = panel().querySelector('input')!, stream = vi.fn();
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'large.png', size: 48 * 1024 * 1024 + 1, stream }] });
    input.dispatchEvent(new Event('change')); await vi.advanceTimersByTimeAsync(0);
    expect(panel().textContent).toContain('安全上限超過'); expect(stream).not.toHaveBeenCalled();
    control('.hover-next').click(); control('.hover-previous').click();
    expect(panel().querySelector('.hover-results')?.textContent).toBe(''); expect(deps.send).not.toHaveBeenCalled();
  });
  it('clears work and caches on any SPA URL change or BFCache entry', async () => {
    const deps = mount(), anchor = card(); await open(anchor); control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    history.pushState({}, '', '/users/456/bookmarks/artworks'); await vi.advanceTimersByTimeAsync(300);
    expect(panel().hidden).toBe(true); expect(panel().querySelector('img')).toBeNull();
    await open(anchor); expect(deps.pages).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); expect(panel().hidden).toBe(true);
  });
  it('rejects forged thumbnail URLs and pending hover on the old route', async () => {
    const deps = mount(), bad = card('123'); bad.querySelector('img')!.src = originalUrl(); await open(bad);
    expect(panel().hidden).toBe(true); expect(deps.pages).not.toHaveBeenCalled();
    bad.querySelector('img')!.src = previewUrl(); enter(bad); history.pushState({}, '', '/ranking.php');
    await vi.advanceTimersByTimeAsync(250); expect(deps.pages).not.toHaveBeenCalled();
  });
  it('keeps a tab-level 429 cooldown shared by hover and panel even if the worker forgets it', async () => {
    const limited = { ...emptyResult('access-denied', ['http-429']), error: { layer: 'original' as const, code: 'http-429', retryAfterMs: 120_000 } };
    const deps = mount({ send: vi.fn().mockResolvedValue(limited) }); await open(card());
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0);
    expect(deps.send).toHaveBeenCalledOnce(); expect(panel().textContent).toContain('このタブから原寸を取得しません');
    await vi.advanceTimersByTimeAsync(121_000); await open(card('456'));
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0); expect(deps.send).toHaveBeenCalledTimes(2);
  });
  it('previews but never inspects a page whose original shape is not recognised', async () => {
    const pages = vi.fn().mockResolvedValue([{ page: 0, original: originalUrl(), preview: previewUrl() }, { page: 1, preview: previewUrl('123', 1), unavailable: 'unsupported-original-format' }]);
    const deps = mount({ pages }); await open(card());
    control('.hover-next').click();
    expect(control('.hover-metadata').disabled).toBe(true); expect(panel().textContent).toContain('検査対象外の形式');
    expect(panel().querySelector('img')?.src).toBe(previewUrl('123', 1));
    control('.hover-metadata').click(); await vi.advanceTimersByTimeAsync(0); expect(deps.send).not.toHaveBeenCalled();
  });
  it('lets the browser choose between API small/regular derivatives', async () => {
    const small = previewUrl().replace('/img-master/', '/c/540x540_70/img-master/');
    mount({ pages: vi.fn().mockResolvedValue([{ page: 0, original: originalUrl(), preview: previewUrl(), previewSmall: small }]) }); await open(card());
    const img = panel().querySelector('img')!;
    expect(img.srcset).toBe(`${small} 540w, ${previewUrl()} 1200w`); expect(img.src).toBe(previewUrl());
  });
  it('closes on Escape without stealing the key from pixiv when focus is elsewhere', async () => {
    mount(); await open(card());
    const outside = document.createElement('input'); document.body.append(outside); outside.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    let reached = false; document.body.addEventListener('keydown', () => { reached = true; });
    outside.dispatchEvent(event);
    expect(panel().hidden).toBe(true); expect(event.defaultPrevented).toBe(false); expect(reached).toBe(true);
    expect(document.activeElement).toBe(outside);
  });
  it('uses one shared ticker and re-attaches the UI if the page removes it', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    mount(); expect(interval).toHaveBeenCalledOnce();
    document.getElementById('pami-extension-root')!.remove();
    await vi.advanceTimersByTimeAsync(300);
    expect(document.getElementById('pami-extension-root')?.isConnected).toBe(true);
    await open(card()); expect(panel().hidden).toBe(false);
  });
  it('renders hostile titles and author names from the page as text only', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const item = document.createElement('li'), anchor = card(); anchor.querySelector('img')!.alt = attack;
    const author = document.createElement('a'); author.href = '/users/9'; author.textContent = attack;
    item.append(anchor, author); document.body.append(item);
    mount(); await open(anchor);
    expect(panel().querySelector('h2')?.textContent).toBe(attack); expect(panel().querySelector('.hover-author')?.textContent).toBe(attack);
    expect(panel().querySelectorAll('script')).toHaveLength(0);
    expect([...panel().querySelectorAll('img')].map(img => img.className)).toEqual(['preview-image']);
    expect(panel().querySelector<HTMLAnchorElement>('.hover-meta a')?.href).toBe('https://www.pixiv.net/artworks/123');
  });
  it('skips the pages request for cards passed over mid-sweep and loads without delay on return (issue #14)', async () => {
    const pages = vi.fn().mockImplementation(async (id: string) => list(id));
    mount({ pages }); const a = card('123'), b = card('456');
    await open(a); expect(pages).toHaveBeenCalledTimes(1);           // first hover: immediate
    leave(a, b); enter(b); await vi.advanceTimersByTimeAsync(250);   // sweep: B opens 250 ms after A
    leave(b, a); enter(a);                                           // pointer moves on before the delay ends
    await vi.advanceTimersByTimeAsync(SWEEP_API_DELAY_MS);
    expect(pages).toHaveBeenCalledTimes(1); expect(panel().textContent).toContain('画像一覧の取得を保留しました');
    leave(a, b); enter(b); await vi.advanceTimersByTimeAsync(0);    // back on B: fetched at once, no new delay
    expect(pages).toHaveBeenCalledTimes(2); expect(control('.hover-counter').textContent).toBe('1 / 3');
  });
});
