// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOCAL_FILES, mountLocalInspector } from '../src/ui/local-inspector';
import { emptyResult, type InspectionResult } from '../src/metadata/types';
import { pngWithText } from './fixtures';

let destroy: (() => void) | undefined;
const fakeFile = (name: string, bytes: Uint8Array<ArrayBuffer>, size = bytes.length) =>
  ({ name, size, stream: () => new NodeBlob([bytes]).stream() }) as unknown as File;
function mount(deps = {}) {
  const host = document.createElement('div'); document.body.append(host);
  destroy = mountLocalInspector(host, deps);
  const root = host.shadowRoot!;
  return {
    root,
    output: () => root.querySelector('[aria-label="ローカル検査結果"]')!,
    status: () => root.querySelector('.local-status')!.textContent ?? '',
    input: () => root.querySelector<HTMLInputElement>('input[type=file]')!,
    drop: () => root.querySelector<HTMLElement>('.dropzone')!,
    items: () => [...root.querySelectorAll<HTMLButtonElement>('.local-item')],
    button: (text: string) => [...root.querySelectorAll('button')].find(b => b.textContent === text)!,
  };
}
const select = (input: HTMLInputElement, files: File[]) => { Object.defineProperty(input, 'files', { configurable: true, value: files }); input.dispatchEvent(new Event('change')); };
const dragEvent = (type: string, init: { files?: File[]; types?: string[] }) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: init.files ?? [], types: init.types ?? (init.files?.length ? ['Files'] : ['text/uri-list']) } });
  return event;
};
afterEach(() => { destroy?.(); destroy = undefined; vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('standalone local inspector page (issue #15)', () => {
  it('inspects a selected PNG locally and renders the shared result view without any network use', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const ui = mount();
    expect(ui.status()).toBe('画像を選ぶと、ここに結果が出ます。'); expect(ui.input().multiple).toBe(true);
    select(ui.input(), [fakeFile('synthetic.png', pngWithText({ Software: 'NovelAI', Comment: '{"prompt":"local prompt","seed":5}' }))]);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('NovelAIで生成したと書かれています'));
    expect(ui.output().textContent).toContain('手元のファイル: synthetic.png'); expect(ui.output().textContent).toContain('local prompt');
    expect(ui.status()).toContain('この端末の中だけで読みました'); expect(fetchSpy).not.toHaveBeenCalled();
    expect(ui.items()).toHaveLength(1); expect(ui.items()[0]!.textContent).toContain('NovelAIで生成したと書かれています');
  });
  it('lists several dropped files, reads them in order, and shows whichever one is chosen', async () => {
    const ui = mount();
    const jpeg = new Uint8Array(readFileSync('tests/reference/fixtures/a1111-exif.jpg'));
    const over = dragEvent('dragover', { files: [fakeFile('a.jpg', jpeg)] }); ui.drop().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true); expect(ui.drop().classList.contains('active')).toBe(true);
    ui.drop().dispatchEvent(dragEvent('drop', { files: [fakeFile('a1111.jpg', jpeg), fakeFile('second.gif', new TextEncoder().encode('GIF89a......'))] }));
    expect(ui.drop().classList.contains('active')).toBe(false);
    expect(ui.items().map(item => item.querySelector('.name')!.textContent)).toEqual(['a1111.jpg', 'second.gif']);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('AUTOMATIC1111 / Forgeの生成情報が入っています'));
    await vi.waitFor(() => expect(ui.items()[1]!.textContent).toContain('読めない形式です'));
    expect(ui.items()[0]!.getAttribute('aria-current')).toBe('true');
    ui.items()[1]!.click();
    expect(ui.items()[1]!.getAttribute('aria-current')).toBe('true'); expect(ui.output().textContent).toContain('読めない形式です');
    expect(ui.status()).toContain('second.gif の結果です');
  });
  it('ignores URL or page-image drags and keeps the browser from opening stray dropped files', () => {
    const ui = mount();
    ui.drop().dispatchEvent(dragEvent('drop', { types: ['text/uri-list'] }));
    expect(ui.status()).toContain('URLやページ上の画像のドラッグは読み込みません'); expect(ui.output().textContent).toBe('');
    const stray = dragEvent('drop', { files: [fakeFile('x.png', new Uint8Array(8))] }); document.body.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(true);
    const link = dragEvent('dragover', { types: ['text/uri-list'] }); document.body.dispatchEvent(link);
    expect(link.defaultPrevented).toBe(false);
  });
  it('reports size limits and unsupported formats safely', async () => {
    const ui = mount(), stream = vi.fn();
    select(ui.input(), [{ name: 'huge.png', size: 48 * 1024 * 1024 + 1, stream } as unknown as File]);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('大きすぎるため、読むのをやめました')); expect(stream).not.toHaveBeenCalled();
    select(ui.input(), [fakeFile('anim.gif', new TextEncoder().encode('GIF89a......'))]);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('読めない形式です'));
  });
  it('reads one file at a time, and cancel stops the running and the queued files', async () => {
    const inspect = vi.fn((_file: File, signal: AbortSignal) => new Promise<InspectionResult>(resolve => signal.addEventListener('abort', () => resolve(emptyResult('cancelled', ['検査を取り消しました。'])))));
    const ui = mount({ inspect });
    select(ui.input(), [fakeFile('a.png', new Uint8Array(8)), fakeFile('b.png', new Uint8Array(8)), fakeFile('c.png', new Uint8Array(8))]);
    expect(inspect).toHaveBeenCalledOnce(); expect(ui.button('取り消し').hidden).toBe(false);
    expect(ui.items().map(item => item.querySelector('.state')!.textContent)).toEqual(['読み込み中…', '順番待ち', '順番待ち']);
    ui.button('取り消し').click();
    await vi.waitFor(() => expect(ui.button('取り消し').hidden).toBe(true));
    expect(inspect).toHaveBeenCalledOnce(); expect(ui.status()).toBe('取り消しました。');
    expect(ui.items().map(item => item.querySelector('.state')!.textContent)).toEqual(['取り消しました', '取り消しました', '取り消しました']);
  });
  it('keeps the list bounded, says so, and clears it on request', async () => {
    const inspect = vi.fn(async (file: File) => ({ ...emptyResult('no-metadata', [], 'png'), source: { kind: 'local' as const, name: file.name } }));
    const ui = mount({ inspect });
    select(ui.input(), Array.from({ length: MAX_LOCAL_FILES + 5 }, (_, i) => fakeFile(`f${i}.png`, new Uint8Array(8))));
    expect(ui.items()).toHaveLength(MAX_LOCAL_FILES);
    await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(MAX_LOCAL_FILES));
    await vi.waitFor(() => expect(ui.status()).toContain(`${MAX_LOCAL_FILES}枚を超えた分は追加していません`));
    select(ui.input(), [fakeFile('new.png', new Uint8Array(8))]);
    expect(ui.items()).toHaveLength(MAX_LOCAL_FILES); expect(ui.items().at(-1)!.textContent).toContain('new.png');
    expect(ui.items()[0]!.textContent).not.toContain('f0.png');
    ui.button('一覧を消す').click();
    expect(ui.items()).toHaveLength(0); expect(ui.output().textContent).toBe(''); expect(ui.button('一覧を消す').hidden).toBe(true);
  });
});
