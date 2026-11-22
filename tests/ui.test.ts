// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInspector, type AppDependencies } from '../src/ui/app';
import { emptyResult } from '../src/metadata/types';
import { renderResult, resultText } from '../src/ui/result';
import { originalUrl } from './fixtures';

let shadow: ShadowRoot;
let destroy: () => void;
const attach = Element.prototype.attachShadow;
const pages = [{ page: 0, original: originalUrl() }, { page: 1, original: originalUrl('123', 1) }];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function button(text: string) { const found = [...shadow.querySelectorAll('button')].find(b => b.textContent === text); if (!found) throw new Error(text); return found; }
function mount(overrides: Partial<AppDependencies> = {}) {
  const deps = { send: vi.fn().mockResolvedValue(emptyResult('no-metadata', [])), pages: vi.fn().mockResolvedValue(pages), ...overrides };
  destroy = mountInspector(deps); return deps;
}
async function open() { button('AI Metadata').click(); await vi.waitFor(() => expect(button('元画像を検査').disabled).toBe(false)); }

beforeEach(() => {
  history.replaceState({}, '', '/artworks/123');
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { expect(init.mode).toBe('closed'); shadow = attach.call(this, init); return shadow; });
});
afterEach(() => { destroy?.(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('synthetic pixiv DOM integration', () => {
  it('injects once and performs no fetch on mount; requires explicit Inspect', async () => {
    const deps = mount(); mountInspector(deps);
    expect(document.querySelectorAll('#metatan-root')).toHaveLength(1); expect(deps.pages).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
    await open(); expect(deps.pages).toHaveBeenCalledOnce(); expect(deps.send).not.toHaveBeenCalled();
    const select = shadow.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change'));
    button('元画像を検査').click(); button('元画像を検査').click();
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledOnce());
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ artworkId: '123', page: 1, url: originalUrl('123', 1) }));
    // Artwork-page requests are bound to the artwork ID, not to an exact URL incl. hash/query.
    expect(vi.mocked(deps.send).mock.calls[0]![0]).not.toHaveProperty('contextUrl');
  });
  it('lists non-inspectable pages without letting them be selected for inspection', async () => {
    const deps = mount({ pages: vi.fn().mockResolvedValue([{ page: 0, unavailable: 'unsupported-original-format' }, { page: 1, original: originalUrl('123', 1) }]) });
    await open();
    const options = shadow.querySelector('select')!.options;
    expect(options[0]!.disabled).toBe(true); expect(options[0]!.textContent).toContain('検査対象外'); expect(shadow.querySelector('select')!.value).toBe('1');
    expect(shadow.textContent).toContain('1枚は検査対象外の形式');
    button('元画像を検査').click(); await vi.waitFor(() => expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
  });
  it('discards a stale listing after SPA navigation, without fetching another automatically', async () => {
    const pending = deferred<typeof pages>(); const deps = mount({ pages: vi.fn().mockReturnValue(pending.promise) });
    button('AI Metadata').click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledOnce());
    history.pushState({}, '', '/artworks/456');
    pending.resolve(pages);
    await vi.waitFor(() => expect(shadow.textContent).toContain('作品が変わりました'));
    await vi.waitFor(() => expect(shadow.querySelector('select')!.options).toHaveLength(0));
    expect(button('元画像を検査').disabled).toBe(true); expect(deps.pages).toHaveBeenCalledOnce();
    button('画像一覧を取得').click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenLastCalledWith('456', expect.any(AbortSignal)));
  });
  it('does not show stale results after navigation or allow the previous image to be scanned', async () => {
    const pending = deferred<ReturnType<typeof emptyResult>>(); const deps = mount({ send: vi.fn().mockReturnValue(pending.promise) });
    await open(); button('元画像を検査').click(); history.pushState({}, '', '/artworks/456');
    pending.resolve({ ...emptyResult('found', ['OLD RESULT']), fields: { prompt: 'old prompt' } });
    await vi.waitFor(() => expect(button('元画像を検査').disabled).toBe(true));
    expect(shadow.textContent).not.toContain('OLD RESULT'); expect(shadow.textContent).not.toContain('old prompt');
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INSPECTION' }));
  });
  it('cancels on page selection and suppresses late results', async () => {
    const pending = deferred<ReturnType<typeof emptyResult>>(); const deps = mount({ send: vi.fn().mockReturnValue(pending.promise) });
    await open(); button('元画像を検査').click(); const select = shadow.querySelector('select')!; select.value = '1'; select.dispatchEvent(new Event('change'));
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INSPECTION' }));
    pending.resolve(emptyResult('found', ['STALE'])); await vi.waitFor(() => expect(button('元画像を検査').disabled).toBe(false));
    expect(shadow.textContent).not.toContain('STALE');
  });
  it('keeps the local fallback usable after denied artwork data', async () => {
    mount({ pages: vi.fn().mockRejectedValue(new Error('403')) }); button('AI Metadata').click();
    await vi.waitFor(() => expect(shadow.textContent).toContain('作品の画像一覧（pixiv API）を取得できませんでした'));
    expect(button('元画像を検査').disabled).toBe(true); expect(button('ローカルファイルを検査').disabled).toBe(false);
  });
  it('rejects an oversized local file before opening its byte stream', async () => {
    const deps = mount(); await open(); button('ローカルファイルを検査').click();
    const file = shadow.querySelector('input[type=file]')!, stream = vi.fn();
    Object.defineProperty(file, 'files', { configurable: true, value: [{ name: 'large.png', size: 48 * 1024 * 1024 + 1, stream }] });
    file.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(shadow.textContent).toContain('安全上限超過'));
    expect(stream).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
  });
  it('supports Escape, focus return, reopening and off-artwork visibility', async () => {
    const deps = mount(); await open(); shadow.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(shadow.querySelector('section')!.hidden).toBe(true); expect(shadow.activeElement).toBe(button('AI Metadata'));
    button('AI Metadata').click(); expect(button('AI Metadata').getAttribute('aria-expanded')).toBe('true'); expect(deps.pages).toHaveBeenCalledOnce();
    history.pushState({}, '', '/users/123'); await vi.waitFor(() => expect(button('AI Metadata').hidden).toBe(true));
    expect(shadow.querySelector('section')!.hidden).toBe(true);
  });
  it('removes UI and cancels outstanding work on teardown', async () => {
    const pending = deferred<typeof pages>(); const deps = mount({ pages: vi.fn().mockReturnValue(pending.promise) });
    button('AI Metadata').click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledOnce());
    destroy(); pending.resolve(pages);
    expect(document.getElementById('metatan-root')).toBeNull(); expect(vi.mocked(deps.pages).mock.calls[0]?.[1]?.aborted).toBe(true);
  });
  it('retains the mount after BFCache but discards candidates and results', async () => {
    const deps = mount(); await open();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(document.getElementById('metatan-root')).not.toBeNull();
    expect(shadow.querySelector('select')!.options).toHaveLength(0);
    expect(shadow.querySelector('section')!.hidden).toBe(true);
    button('AI Metadata').click(); await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledTimes(2));
  });
});

describe('untrusted display and explicit clipboard access', () => {
  it('shows signature/Stealth states only when bytes were parsed, and failures first', () => {
    const container = document.createElement('div');
    renderResult(container, { ...emptyResult('access-denied', ['http-403 explanation', 'local route']), error: { layer: 'original', code: 'http-403' } });
    expect(container.textContent).not.toContain('NovelAI電子署名'); expect(container.textContent).not.toContain('Stealth');
    expect(container.querySelector('.result-problem')?.textContent).toContain('http-403 explanation');
    expect(container.querySelector('.result-summary')?.textContent).toBe('取得不能');
    renderResult(container, { ...emptyResult('found', ['note'], 'png'), novelaiSignature: 'not-checked', stealth: 'found', detected: ['novelai'], generator: 'novelai', confidence: 'metadata-indicates' });
    expect(container.querySelector('.result-summary')?.textContent).toBe('テキスト情報あり / png / メタデータから推定: novelai');
    expect(container.textContent).toContain('NovelAI電子署名: 未検証（署名データの記載あり');
    expect(container.textContent).toContain('Stealth（アルファチャンネル）: stealth_pngcompデータあり');
    expect(container.textContent).not.toContain('検証成功');
    renderResult(container, { ...emptyResult('no-metadata', [], 'png'), novelaiSignature: 'not-present', stealth: 'not-checked' });
    expect(container.textContent).toContain('通常テキストに署名データなし（Stealth未検査）');
    renderResult(container, { ...emptyResult('found', [], 'jpeg'), novelaiSignature: 'not-present' });
    expect(container.textContent).not.toContain('NovelAI電子署名');
  });
  it('renders executable-looking metadata only as text, including RAW and source names', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const attack = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const result = { ...emptyResult('found', [attack]), fields: { [attack]: attack }, textEntries: [{ keyword: 'prompt', value: attack, kind: 'tEXt' as const }], source: { kind: 'local' as const, name: attack } };
    renderResult(container, result);
    expect(container.querySelector('img,script')).toBeNull(); expect(container.textContent).toContain(attack);
    const details = container.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle'));
    expect(details.querySelector('pre')?.textContent).toContain(attack); expect(container.querySelector('img,script')).toBeNull();
  });
  it('copies preserved newlines and normalized JSON only on click, and reports denial', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const container = document.createElement('div'); const result = { ...emptyResult('found', []), fields: { prompt: 'line 1\nline 2' } };
    renderResult(container, result); expect(writeText).not.toHaveBeenCalled();
    const find = (name: string) => [...container.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)!;
    find('結果をコピー').click(); await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(resultText(result)));
    find('正規化JSONをコピー').click(); expect(JSON.parse(writeText.mock.calls.at(-1)![0])).toEqual(result);
    find('Promptをコピー').click(); expect(writeText.mock.calls.at(-1)![0]).toBe('line 1\nline 2');
    writeText.mockRejectedValue(new Error('denied')); find('結果をコピー').click(); await vi.waitFor(() => expect(container.textContent).toContain('コピーが許可されませんでした'));
  });
  it('renders worker results after JSON transport without prototype pollution or markup', () => {
    const container = document.createElement('div');
    const wire = JSON.parse(JSON.stringify({ ...emptyResult('found', [], 'png'), fields: { prompt: '<b>x</b>' }, textEntries: [{ keyword: '__proto__', value: '{"polluted":true}', kind: 'tEXt' }] }).replace('"fields":{', '"fields":{"__proto__":{"polluted":true},'));
    renderResult(container, wire);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(container.querySelector('b')).toBeNull(); expect(container.textContent).toContain('<b>x</b>');
  });
});
