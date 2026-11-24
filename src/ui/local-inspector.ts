import { MAX_IMAGE_BYTES } from '../limits';
import { emptyResult, type InspectionResult } from '../metadata/types';
import { inspectLocalFile } from './local-file';
import { renderResult, verdict } from './result';
import { STYLES } from './styles';

export interface LocalInspectorDependencies { inspect?: typeof inspectLocalFile }
/** Files kept in the list at once. They are read one after another, never in parallel. */
export const MAX_LOCAL_FILES = 20;

interface Entry {
  file: File; state: 'waiting' | 'running' | 'done'; result?: InspectionResult; url?: string;
  item: HTMLLIElement; button: HTMLButtonElement; stateText: HTMLElement;
}

/**
 * Standalone local-file inspector (extension page opened from the toolbar icon, issue #15).
 * Files are read locally, never uploaded or stored, and are not associated with any pixiv artwork.
 * The page makes no network requests. The chosen image is shown through an object URL that exists
 * only in this extension page and is revoked when the file leaves the list.
 */
export function mountLocalInspector(container: HTMLElement, deps: LocalInspectorDependencies = {}): () => void {
  const inspect = deps.inspect ?? inspectLocalFile;
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = STYLES;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
  };
  const button = (label: string, className = '') => { const b = el('button', label, className); b.type = 'button'; return b; };
  const page = el('main', undefined, 'local-page');
  const wrap = el('div', undefined, 'local-wrap');
  const header = el('header');
  header.append(el('h1', '手元の画像を調べる'), el('p', 'PNG・JPEG・WebPに埋め込まれた生成情報を、この端末の中だけで読みます。ファイルを外に送ったり、保存したりはしません。', 'local-intro'));
  const layout = el('div', undefined, 'local-layout');
  const side = el('div', undefined, 'local-side');
  const drop = el('section', undefined, 'dropzone'); drop.setAttribute('aria-label', '画像ファイルのドロップ領域');
  const choose = button('ファイルを選ぶ', 'primary');
  const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.multiple = true; file.hidden = true;
  drop.append(el('p', 'ここに画像をドロップ'), choose, el('p', `PNG・JPEG・WebP、1枚48 MiBまで。一覧には${MAX_LOCAL_FILES}枚まで入ります。`, 'dropzone-hint'), file);
  const actions = el('div', undefined, 'local-actions');
  const cancel = button('取り消し'); cancel.hidden = true;
  const clear = button('一覧を消す'); clear.hidden = true;
  actions.append(cancel, clear);
  const list = el('ol', undefined, 'local-list'); list.setAttribute('aria-label', '調べた画像');
  side.append(drop, actions, list);
  const detail = el('section', undefined, 'local-detail'); detail.setAttribute('aria-label', '選んだ画像');
  const preview = el('img', undefined, 'local-preview'); preview.alt = ''; preview.hidden = true;
  const body = el('div', undefined, 'local-detail-body');
  const status = el('p', '画像を選ぶと、ここに結果が出ます。', 'local-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const output = el('div', undefined, 'local-results'); output.setAttribute('aria-label', 'ローカル検査結果');
  body.append(status, output);
  detail.append(preview, body);
  layout.append(side, detail);
  wrap.append(header, layout, el('p', '生成情報は画像に書かれた申告で、誰でも書き換えられます。情報が見つからなくても、人が描いた証拠にはなりません。', 'local-footer'));
  page.append(wrap);
  shadow.append(style, page);

  let entries: Entry[] = [], selected: Entry | undefined, running: { entry: Entry; controller: AbortController } | undefined;
  let notice = '';
  const objectUrl = (selectedFile: File) => {
    if (selectedFile.size > MAX_IMAGE_BYTES || typeof URL.createObjectURL !== 'function') return undefined;
    try { return URL.createObjectURL(selectedFile); } catch { return undefined; }
  };
  const release = (entry: Entry) => { if (entry.url) URL.revokeObjectURL(entry.url); entry.item.remove(); };
  const stateLabel = (entry: Entry) => entry.state === 'waiting' ? '順番待ち' : entry.state === 'running' ? '読み込み中…' : entry.result ? verdict(entry.result).title : '';
  const showSelected = () => {
    for (const entry of entries) entry.button.setAttribute('aria-current', String(entry === selected));
    clear.hidden = !entries.length;
    cancel.hidden = !running;
    if (!selected) { preview.hidden = true; preview.removeAttribute('src'); output.replaceChildren(); status.textContent = notice || '画像を選ぶと、ここに結果が出ます。'; return; }
    preview.hidden = !selected.url; if (selected.url) preview.src = selected.url; else preview.removeAttribute('src');
    preview.alt = selected.file.name;
    if (selected.state !== 'done' || !selected.result) {
      output.replaceChildren();
      status.textContent = selected.state === 'running' ? `${selected.file.name} を読み込んでいます…` : `${selected.file.name} は順番を待っています。`;
      return;
    }
    renderResult(output, selected.result);
    status.textContent = (selected.result.status === 'cancelled' ? '取り消しました。' : `${selected.file.name} の結果です。この端末の中だけで読みました。`) + notice;
  };
  const update = (entry: Entry) => { entry.stateText.textContent = stateLabel(entry); if (entry === selected) showSelected(); };
  const pump = async () => {
    if (running) return;
    const entry = entries.find(item => item.state === 'waiting');
    if (!entry) { showSelected(); return; }
    const controller = new AbortController(); running = { entry, controller };
    entry.state = 'running'; update(entry); cancel.hidden = false;
    try { entry.result = await inspect(entry.file, controller.signal); }
    catch { entry.result = emptyResult('parse-error', ['ファイルを読み込めませんでした。']); }
    finally {
      entry.state = 'done'; if (running?.entry === entry) running = undefined;
      // The entry may have been removed from the list while it was being read.
      if (entries.includes(entry)) update(entry);
      void pump();
    }
  };
  const add = (files: File[]) => {
    notice = files.length > MAX_LOCAL_FILES ? ` ${MAX_LOCAL_FILES}枚を超えた分は追加していません。` : '';
    const added: Entry[] = [];
    for (const selectedFile of files.slice(0, MAX_LOCAL_FILES)) {
      const item = el('li'), itemButton = button('', 'local-item'), text = el('span', undefined, 'text'), stateText = el('span', '', 'state');
      const url = objectUrl(selectedFile);
      const thumb = url ? el('img', undefined, 'thumb') : el('span', undefined, 'thumb');
      if (thumb instanceof HTMLImageElement && url) { thumb.src = url; thumb.alt = ''; }
      text.append(el('span', selectedFile.name, 'name'), stateText);
      itemButton.append(thumb, text); item.append(itemButton); list.append(item);
      const entry: Entry = { file: selectedFile, state: 'waiting', url, item, button: itemButton, stateText };
      itemButton.addEventListener('click', () => { selected = entry; notice = ''; showSelected(); });
      entries.push(entry); added.push(entry); update(entry);
    }
    // Keep the list bounded: drop the oldest finished entries first.
    while (entries.length > MAX_LOCAL_FILES) {
      const oldest = entries.find(entry => entry.state === 'done') ?? entries.find(entry => entry.state === 'waiting');
      if (!oldest) break;
      entries = entries.filter(entry => entry !== oldest); release(oldest);
    }
    selected = added.find(entry => entries.includes(entry)) ?? selected;
    showSelected(); void pump();
  };
  const take = (files: FileList | File[] | null | undefined) => {
    const chosen = files ? Array.from(files) : [];
    if (!chosen.length) { status.textContent = 'ファイルをドロップしてください。URLやページ上の画像のドラッグは読み込みません。'; return; }
    add(chosen);
  };
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  choose.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => { take(file.files); file.value = ''; });
  cancel.addEventListener('click', () => {
    running?.controller.abort();
    for (const entry of entries) if (entry.state === 'waiting') { entry.state = 'done'; entry.result = emptyResult('cancelled', ['検査を取り消しました。']); update(entry); }
    notice = ''; showSelected();
  });
  clear.addEventListener('click', () => {
    running?.controller.abort();
    for (const entry of entries) release(entry);
    entries = []; selected = undefined; notice = ''; showSelected();
  });
  drop.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); drop.classList.add('active'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('active'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('active'); take(event.dataTransfer?.files); });
  // Never let the browser navigate to a file dropped outside the drop zone.
  const guard = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
  window.addEventListener('dragover', guard); window.addEventListener('drop', guard);
  return () => {
    running?.controller.abort();
    for (const entry of entries) release(entry);
    entries = [];
    window.removeEventListener('dragover', guard); window.removeEventListener('drop', guard);
    page.remove(); style.remove();
  };
}
