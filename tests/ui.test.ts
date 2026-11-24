// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInspector, type AppDependencies } from '../src/ui/app';
import { emptyResult, type InspectionResult } from '../src/metadata/types';
import { InspectionError } from '../src/limits';
import { renderResult, resultText, verdict } from '../src/ui/result';
import { originalUrl } from './fixtures';

let shadow: ShadowRoot;
let destroy: () => void;
const attach = Element.prototype.attachShadow;
const pages = [{ page: 0, original: originalUrl() }, { page: 1, original: originalUrl('123', 1) }];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mount(overrides: Partial<AppDependencies> = {}) {
  const deps = { send: vi.fn().mockResolvedValue(emptyResult('no-metadata', [])), pages: vi.fn().mockResolvedValue(pages), ...overrides };
  destroy = mountInspector(deps); return deps;
}
const toggle = () => shadow.querySelector<HTMLButtonElement>('.toggle')!;
const panel = () => shadow.querySelector<HTMLElement>('#metatan-preview')!;
const control = <T extends HTMLElement = HTMLButtonElement>(selector: string) => panel().querySelector<T>(selector)!;
async function open() { toggle().click(); await vi.waitFor(() => expect(control('.hover-metadata').disabled).toBe(false)); }

beforeEach(() => {
  history.replaceState({}, '', '/artworks/123');
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { expect(init.mode).toBe('closed'); shadow = attach.call(this, init); return shadow; });
});
afterEach(() => { destroy?.(); vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('artwork page: the same viewer, opened from its own button', () => {
  it('injects once and performs no fetch on mount; inspects one page only on an explicit click', async () => {
    const deps = mount(); mountInspector(deps);
    expect(document.querySelectorAll('#metatan-root')).toHaveLength(1); expect(deps.pages).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
    expect(toggle().textContent).toBe('生成情報'); expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await open(); expect(deps.pages).toHaveBeenCalledOnce(); expect(deps.send).not.toHaveBeenCalled();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    control('.hover-next').click(); expect(control('.hover-counter').textContent).toBe('2 / 2');
    control('.hover-metadata').click(); control('.hover-metadata').click();
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledOnce());
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ artworkId: '123', page: 1, url: originalUrl('123', 1) }));
    // Artwork-page requests are bound to the artwork ID, not to an exact URL incl. hash/query.
    expect(vi.mocked(deps.send).mock.calls[0]![0]).not.toHaveProperty('contextUrl');
    await vi.waitFor(() => expect(control('.hover-results').textContent).toContain('生成情報は見つかりませんでした'));
  });
  it('shows non-inspectable pages without letting them be inspected', async () => {
    const deps = mount({ pages: vi.fn().mockResolvedValue([{ page: 0, unavailable: 'unsupported-original-format' }, { page: 1, original: originalUrl('123', 1) }]) });
    toggle().click(); await vi.waitFor(() => expect(control('.hover-counter').textContent).toBe('1 / 2'));
    expect(control('.hover-unavailable').hidden).toBe(false); expect(control('.hover-metadata').hidden).toBe(true);
    control('.hover-metadata').click(); expect(deps.send).not.toHaveBeenCalled();
    control('.hover-next').click(); expect(control('.hover-metadata').disabled).toBe(false);
    control('.hover-metadata').click(); await vi.waitFor(() => expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
  });
  it('keeps working across hash and query changes on the same artwork', async () => {
    const deps = mount(); await open();
    history.replaceState({}, '', '/artworks/123?p=1#comments');
    control('.hover-metadata').click();
    await vi.waitFor(() => expect(deps.send).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(control('.hover-results').textContent).toContain('生成情報は見つかりませんでした'));
    expect(panel().hidden).toBe(false);
  });
  it('closes on navigation to another artwork and never lists the new one by itself', async () => {
    const pending = deferred<typeof pages>(); const deps = mount({ pages: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(pages) });
    toggle().click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledOnce());
    history.pushState({}, '', '/artworks/456');
    pending.resolve(pages);
    await vi.waitFor(() => expect(panel().hidden).toBe(true));
    expect(deps.pages).toHaveBeenCalledOnce();
    toggle().click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenLastCalledWith('456', expect.any(AbortSignal)));
  });
  it('does not show stale results after navigation or allow the previous image to be scanned', async () => {
    const pending = deferred<InspectionResult>(); const deps = mount({ send: vi.fn().mockReturnValue(pending.promise) });
    await open(); control('.hover-metadata').click(); history.pushState({}, '', '/artworks/456');
    pending.resolve({ ...emptyResult('found', ['OLD RESULT']), fields: { prompt: 'old prompt' } });
    await vi.waitFor(() => expect(panel().hidden).toBe(true));
    expect(shadow.textContent).not.toContain('OLD RESULT'); expect(shadow.textContent).not.toContain('old prompt');
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INSPECTION' }));
  });
  it('cancels when switching pages and suppresses late results', async () => {
    const pending = deferred<InspectionResult>(); const deps = mount({ send: vi.fn().mockReturnValue(pending.promise) });
    await open(); control('.hover-metadata').click(); control('.hover-next').click();
    expect(deps.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL_INSPECTION' }));
    pending.resolve(emptyResult('found', ['STALE'])); await vi.waitFor(() => expect(control('.hover-metadata').disabled).toBe(false));
    expect(shadow.textContent).not.toContain('STALE');
    expect(control('.hover-results').textContent).toContain('まだ読み込んでいません');
  });
  it('offers the local route after denied artwork data, with the short reason first', async () => {
    const deps = mount({ pages: vi.fn().mockRejectedValue(new InspectionError('pixiv-pages-http-403')) }); toggle().click();
    await vi.waitFor(() => expect(control('.hover-info').hidden).toBe(false));
    expect(control('.hover-info p').textContent).toBe('画像の一覧を読み込めませんでした。pixivが拒否しました。');
    expect(control('.hover-info details').textContent).toContain('作品の画像一覧（pixiv API）を取得できませんでした（pixiv-pages-http-403）');
    expect(control('.hover-metadata').disabled).toBe(true);
    expect(control('.hover-local').hidden).toBe(false); expect(control('.hover-local').disabled).toBe(false);
    expect(deps.send).not.toHaveBeenCalled();
  });
  it('rejects an oversized local file before opening its byte stream', async () => {
    const deps = mount({ pages: vi.fn().mockRejectedValue(new Error('offline')) }); toggle().click();
    await vi.waitFor(() => expect(control('.hover-local').hidden).toBe(false));
    control('.hover-local').click();
    const file = control<HTMLInputElement>('input[type=file]'), stream = vi.fn();
    Object.defineProperty(file, 'files', { configurable: true, value: [{ name: 'large.png', size: 48 * 1024 * 1024 + 1, stream }] });
    file.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(control('.hover-results').textContent).toContain('大きすぎるため、読むのをやめました'));
    expect(control('.hover-results').textContent).toContain('表示中の作品と同じ画像かは確かめていません');
    expect(stream).not.toHaveBeenCalled(); expect(deps.send).not.toHaveBeenCalled();
  });
  it('supports Escape with focus return, toggling and off-artwork visibility', async () => {
    const deps = mount(); await open();
    panel().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    expect(panel().hidden).toBe(true); expect(shadow.activeElement).toBe(toggle()); expect(toggle().getAttribute('aria-expanded')).toBe('false');
    toggle().click(); expect(toggle().getAttribute('aria-expanded')).toBe('true'); expect(deps.pages).toHaveBeenCalledOnce();
    toggle().click(); expect(panel().hidden).toBe(true);
    history.pushState({}, '', '/users/123'); await vi.waitFor(() => expect(toggle().hidden).toBe(true));
  });
  it('stays open when the pointer leaves, and closes on a click outside', async () => {
    mount(); await open();
    panel().dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise(resolve => setTimeout(resolve, 300)); expect(panel().hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    expect(panel().hidden).toBe(true);
  });
  it('removes UI and cancels outstanding work on teardown', async () => {
    const pending = deferred<typeof pages>(); const deps = mount({ pages: vi.fn().mockReturnValue(pending.promise) });
    toggle().click();
    await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledOnce());
    destroy(); pending.resolve(pages);
    expect(document.getElementById('metatan-root')).toBeNull(); expect(vi.mocked(deps.pages).mock.calls[0]?.[1]?.aborted).toBe(true);
  });
  it('retains the mount after BFCache but discards pages and results', async () => {
    const deps = mount(); await open();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(document.getElementById('metatan-root')).not.toBeNull();
    expect(panel().hidden).toBe(true); expect(panel().querySelector('img')).toBeNull();
    toggle().click(); await vi.waitFor(() => expect(deps.pages).toHaveBeenCalledTimes(2));
  });
});

describe('result sheet: one sentence first, untrusted text only, explicit clipboard access', () => {
  it('states the claim, its trust level, and shows signature/Stealth only when bytes were parsed', () => {
    const container = document.createElement('div');
    renderResult(container, { ...emptyResult('access-denied', ['http-403 explanation', 'local route']), error: { layer: 'original', code: 'http-403' } });
    expect(container.querySelector('.verdict-title')?.textContent).toBe('原寸画像を読み込めませんでした');
    expect(container.querySelector('.verdict-detail')?.textContent).toBe('画像配信サーバーが拒否しました。');
    expect(container.querySelector('.result-more > summary')?.textContent).toBe('くわしい理由');
    expect(container.querySelector('.result-more')?.textContent).toContain('http-403 explanation');
    expect(container.textContent).not.toContain('NovelAI電子署名'); expect(container.textContent).not.toContain('Stealth');
    expect(container.querySelector('.trust-scale')).toBeNull();

    renderResult(container, { ...emptyResult('found', ['note'], 'png'), novelaiSignature: 'not-checked', stealth: 'found', detected: ['novelai'], generator: 'novelai', confidence: 'metadata-indicates' });
    expect(container.querySelector('.verdict-title')?.textContent).toBe('NovelAIで生成したと書かれています');
    expect(container.querySelector('.verdict-detail')?.textContent).toBe('画像に書かれた申告で、証明ではありません。');
    expect(container.querySelector('.trust-scale [aria-current=step]')?.textContent).toBe('署名あり・未確認');
    expect(container.querySelector('.trust-scale .unavailable')?.textContent).toBe('署名を確認済み（未対応）');
    expect(container.textContent).toContain('NovelAI電子署名: 未検証（署名データの記載あり');
    expect(container.textContent).toContain('Stealth（アルファチャンネル）: stealth_pngcompデータあり');
    expect(container.textContent).toContain('形式: PNG');
    expect(container.textContent).not.toContain('検証成功');

    renderResult(container, { ...emptyResult('found', [], 'png'), novelaiSignature: 'not-present', stealth: 'not-present', detected: ['novelai'] });
    expect(container.querySelector('.trust-scale [aria-current=step]')?.textContent).toBe('書いてあるだけ');

    renderResult(container, { ...emptyResult('no-metadata', [], 'png'), novelaiSignature: 'not-present', stealth: 'not-checked' });
    expect(container.querySelector('.verdict-title')?.textContent).toBe('生成情報は見つかりませんでした');
    expect(container.querySelector('.verdict-detail')?.textContent).toBe('情報がないことは、人が描いた証拠にはなりません。');
    expect(container.textContent).toContain('通常テキストに署名データなし（Stealth未検査）');
    expect(container.querySelector('.trust-scale')).toBeNull();

    renderResult(container, { ...emptyResult('found', [], 'jpeg'), novelaiSignature: 'not-present', detected: ['a1111-forge'] });
    expect(container.querySelector('.verdict-title')?.textContent).toBe('AUTOMATIC1111 / Forgeの生成情報が入っています');
    expect(container.textContent).not.toContain('NovelAI電子署名');
  });
  it('words every status, including waits, busy workers and graph-only ComfyUI data', () => {
    expect(verdict({ ...emptyResult('access-denied', []), error: { layer: 'original', code: 'http-429', retryAfterMs: 120_000 } }).detail).toBe('リクエストが制限されています。あと約2分は、このタブから読み込みません。');
    expect(verdict({ ...emptyResult('access-denied', []), error: { layer: 'pages', code: 'pixiv-pages-timeout' } }).title).toBe('画像の一覧を読み込めませんでした');
    expect(verdict(emptyResult('access-denied', ['拡張機能と通信できませんでした。再読み込みしてください。'])).detail).toBe('拡張機能と通信できませんでした。');
    expect(verdict(emptyResult('busy', [])).title).toBe('別の画像を読み込んでいます');
    expect(verdict(emptyResult('unsupported-format', [])).title).toBe('読めない形式です');
    expect(verdict(emptyResult('too-large', [])).failure).toBe(true);
    expect(verdict({ ...emptyResult('found', []), detected: ['comfyui'] }).detail).toContain('ノードのデータを開いて');
    expect(verdict({ ...emptyResult('found', []), detected: ['novelai', 'a1111-forge'] }).title).toBe('NovelAIとAUTOMATIC1111 / Forgeの生成情報が入っています');
    expect(verdict(emptyResult('found', [])).title).toBe('生成ツールは書かれていません');
  });
  it('labels known settings in Japanese, keeps unknown keys as they are, and folds secondary prompts', () => {
    const container = document.createElement('div');
    renderResult(container, { ...emptyResult('found', []), fields: { prompt: 'p', negative: 'n', 'character 1 prompt': 'c', seed: '42', 'A1111 cfg': '7', 'Custom Key': 'v', 'ComfyUI workflow JSON': '{}' } });
    expect([...container.querySelectorAll('.settings dt')].map(dt => dt.textContent)).toEqual(['シード', 'CFGスケール（A1111形式）', 'Custom Key']);
    expect([...container.querySelectorAll('details.field > summary')].map(s => s.textContent)).toEqual(['ネガティブプロンプト', 'キャラクター1のプロンプト']);
    expect(container.querySelector('.field h4')?.textContent).toBe('プロンプト');
    expect(container.querySelector('details.raw > summary')?.textContent).toBe('ComfyUIのワークフロー（JSON）');
  });
  it('clamps a long prompt behind an explicit toggle', () => {
    const container = document.createElement('div');
    renderResult(container, { ...emptyResult('found', []), fields: { prompt: 'word, '.repeat(80) } });
    const text = container.querySelector('.field-text')!, more = container.querySelector<HTMLButtonElement>('.text-button')!;
    expect(text.classList.contains('clamped')).toBe(true); expect(more.textContent).toBe('すべて表示');
    more.click(); expect(text.classList.contains('clamped')).toBe(false); expect(more.getAttribute('aria-expanded')).toBe('true');
    renderResult(container, { ...emptyResult('found', []), fields: { prompt: 'short' } });
    expect(container.querySelector('.text-button')).toBeNull();
  });
  it('renders executable-looking metadata only as text, including RAW and source names', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const attack = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const result = { ...emptyResult('found', [attack]), fields: { [attack]: attack }, textEntries: [{ keyword: 'prompt', value: attack, kind: 'tEXt' as const }], source: { kind: 'local' as const, name: attack } };
    renderResult(container, result, attack);
    expect(container.querySelector('img,script')).toBeNull(); expect(container.textContent).toContain(attack);
    const raw = [...container.querySelectorAll<HTMLDetailsElement>('details.raw')].find(d => d.querySelector('summary')?.textContent?.startsWith('生データ'))!;
    raw.open = true; raw.dispatchEvent(new Event('toggle'));
    expect(raw.querySelector('pre')?.textContent).toContain(attack); expect(container.querySelector('img,script')).toBeNull();
  });
  it('copies preserved newlines and normalized JSON only on click, with feedback on the pressed button', async () => {
    vi.useFakeTimers();
    try {
      const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
      const container = document.createElement('div'); const result = { ...emptyResult('found', []), fields: { prompt: 'line 1\nline 2' } };
      renderResult(container, result); expect(writeText).not.toHaveBeenCalled();
      const find = (name: string) => [...container.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name)!;
      find('結果をコピー').click(); await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledWith(resultText(result)); expect(find('結果をコピー').textContent).toBe('コピーしました');
      await vi.advanceTimersByTimeAsync(1600); expect(find('結果をコピー').textContent).toBe('結果をコピー');
      find('正規化JSONをコピー').click(); await vi.advanceTimersByTimeAsync(0); expect(JSON.parse(writeText.mock.calls.at(-1)![0])).toEqual(result);
      find('プロンプトをコピー').click(); await vi.advanceTimersByTimeAsync(0); expect(writeText.mock.calls.at(-1)![0]).toBe('line 1\nline 2');
      writeText.mockRejectedValue(new Error('denied')); find('結果をコピー').click(); await vi.advanceTimersByTimeAsync(0);
      expect(container.textContent).toContain('コピーが許可されませんでした'); expect(find('結果をコピー').textContent).toBe('コピーできません');
      expect(find('結果をコピー').nextElementSibling?.textContent).toBe('文字を選んでコピーしてください');
    } finally { vi.useRealTimers(); }
  });
  it('renders worker results after JSON transport without prototype pollution or markup', () => {
    const container = document.createElement('div');
    const wire = JSON.parse(JSON.stringify({ ...emptyResult('found', [], 'png'), fields: { prompt: '<b>x</b>' }, textEntries: [{ keyword: '__proto__', value: '{"polluted":true}', kind: 'tEXt' }] }).replace('"fields":{', '"fields":{"__proto__":{"polluted":true},'));
    renderResult(container, wire);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(container.querySelector('b')).toBeNull(); expect(container.textContent).toContain('<b>x</b>');
  });
});
