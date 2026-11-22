// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountLocalInspector } from '../src/ui/local-inspector';
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
    status: () => root.querySelector('[role="status"]')!.textContent ?? '',
    input: () => root.querySelector<HTMLInputElement>('input[type=file]')!,
    drop: () => root.querySelector<HTMLElement>('.dropzone')!,
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
    select(ui.input(), [fakeFile('synthetic.png', pngWithText({ Software: 'NovelAI', Comment: '{"prompt":"local prompt","seed":5}' }))]);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('メタデータから推定: novelai'));
    expect(ui.output().textContent).toContain('ローカル: synthetic.png'); expect(ui.output().textContent).toContain('local prompt');
    expect(ui.status()).toContain('ローカル処理のみ'); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('accepts a dropped JPEG with A1111 EXIF written by the upstream code', async () => {
    const ui = mount();
    const jpeg = new Uint8Array(readFileSync('tests/reference/fixtures/a1111-exif.jpg'));
    const over = dragEvent('dragover', { files: [fakeFile('a.jpg', jpeg)] }); ui.drop().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true); expect(ui.drop().classList.contains('active')).toBe(true);
    ui.drop().dispatchEvent(dragEvent('drop', { files: [fakeFile('a1111.jpg', jpeg), fakeFile('second.png', new Uint8Array(8))] }));
    await vi.waitFor(() => expect(ui.output().textContent).toContain('メタデータから推定: a1111-forge'));
    await vi.waitFor(() => expect(ui.status()).toContain('最初の1件だけ'));
    expect(ui.drop().classList.contains('active')).toBe(false);
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
    await vi.waitFor(() => expect(ui.output().textContent).toContain('安全上限超過')); expect(stream).not.toHaveBeenCalled();
    select(ui.input(), [fakeFile('anim.gif', new TextEncoder().encode('GIF89a......'))]);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('未対応形式'));
  });
  it('lets a newer file supersede a running one and supports cancel', async () => {
    let release!: (result: InspectionResult) => void;
    const inspect = vi.fn()
      .mockImplementationOnce((_file: File, signal: AbortSignal) => new Promise<InspectionResult>(resolve => { release = resolve; signal.addEventListener('abort', () => resolve(emptyResult('cancelled', []))); }))
      .mockImplementationOnce(async () => ({ ...emptyResult('found', ['SECOND'], 'png'), source: { kind: 'local' as const, name: 'b.png' } }))
      .mockImplementationOnce((_file: File, signal: AbortSignal) => new Promise<InspectionResult>(resolve => signal.addEventListener('abort', () => resolve(emptyResult('cancelled', ['検査を取り消しました。'])))));
    const ui = mount({ inspect });
    select(ui.input(), [fakeFile('a.png', new Uint8Array(8))]);
    expect(inspect.mock.calls[0]![1].aborted).toBe(false); expect(ui.button('取り消し').hidden).toBe(false);
    select(ui.input(), [fakeFile('b.png', new Uint8Array(8))]);
    expect(inspect.mock.calls[0]![1].aborted).toBe(true);
    await vi.waitFor(() => expect(ui.output().textContent).toContain('SECOND'));
    release(emptyResult('found', ['STALE']));
    expect(ui.output().textContent).not.toContain('STALE');
    select(ui.input(), [fakeFile('c.png', new Uint8Array(8))]); ui.button('取り消し').click();
    await vi.waitFor(() => expect(ui.status()).toBe('検査を取り消しました。'));
    expect(ui.button('取り消し').hidden).toBe(true);
  });
});
