import { inspectLocalFile } from './local-file';
import { renderResult } from './result';
import { STYLES } from './styles';

export interface LocalInspectorDependencies { inspect?: typeof inspectLocalFile }

/**
 * Standalone local-file inspector (extension page opened from the toolbar icon, issue #15).
 * Reuses inspectLocalFile/renderResult. Files are read locally, never uploaded or stored, and are
 * not associated with any pixiv artwork. The page makes no network requests.
 */
export function mountLocalInspector(container: HTMLElement, deps: LocalInspectorDependencies = {}): () => void {
  const inspect = deps.inspect ?? inspectLocalFile;
  const shadow = container.attachShadow({ mode: 'open' });
  const style = document.createElement('style'); style.textContent = STYLES;
  const page = document.createElement('main'); page.className = 'local-page';
  const title = document.createElement('h1'); title.textContent = 'ローカル画像のメタデータ検査';
  const intro = document.createElement('p'); intro.className = 'intro';
  intro.textContent = '手元のPNG・JPEG・WebPファイルに埋め込まれた生成情報を、この端末内だけで読み取ります。ファイルは外部へ送信・保存しません。pixivの作品と同じ画像かどうかは確認しません。';
  const drop = document.createElement('section'); drop.className = 'dropzone'; drop.setAttribute('aria-label', '画像ファイルのドロップ領域');
  const dropText = document.createElement('p'); dropText.textContent = 'ここに画像ファイルをドロップ';
  const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'primary'; choose.textContent = 'ファイルを選択';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取り消し'; cancel.hidden = true;
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
  const status = document.createElement('p'); status.className = 'local-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const output = document.createElement('div'); output.setAttribute('aria-label', 'ローカル検査結果');
  const limits = document.createElement('p'); limits.className = 'result-notes';
  limits.textContent = '対応: PNGテキスト（NovelAI・ComfyUI・AUTOMATIC1111/Forge）、NovelAI Stealth、JPEG/WebPのEXIF。上限48 MiB・40百万画素。生成情報は自己申告で、情報がないことは人間が描いた証拠になりません。';
  drop.append(dropText, choose, cancel, file);
  page.append(title, intro, drop, status, output, limits);
  shadow.append(style, page);

  let operation: AbortController | undefined;
  const run = async (selected: File) => {
    operation?.abort();
    const controller = new AbortController(); operation = controller;
    cancel.hidden = false; output.replaceChildren(); status.textContent = `${selected.name} を解析中…`;
    try {
      const result = await inspect(selected, controller.signal);
      if (operation !== controller) return; // superseded by a newer file
      renderResult(output, result);
      status.textContent = result.status === 'cancelled' ? '検査を取り消しました。' : `${selected.name} の検査結果です（ローカル処理のみ）。`;
    } finally {
      if (operation === controller) { operation = undefined; cancel.hidden = true; }
    }
  };
  const take = (files: FileList | File[] | null | undefined) => {
    const list = files ? Array.from(files) : [];
    if (!list.length) { status.textContent = 'ファイルをドロップしてください。URLやページ上の画像のドラッグは読み込みません。'; return; }
    void run(list[0]!).then(() => { if (list.length > 1) status.textContent += ` 複数のファイルのうち最初の1件だけを検査しました。`; });
  };
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  choose.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => { take(file.files); file.value = ''; });
  cancel.addEventListener('click', () => { operation?.abort(); });
  drop.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); drop.classList.add('active'); } });
  drop.addEventListener('dragleave', () => drop.classList.remove('active'));
  drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('active'); take(event.dataTransfer?.files); });
  // Never let the browser navigate to a file dropped outside the drop zone.
  const guard = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault(); };
  window.addEventListener('dragover', guard); window.addEventListener('drop', guard);
  return () => {
    operation?.abort();
    window.removeEventListener('dragover', guard); window.removeEventListener('drop', guard);
    page.remove(); style.remove();
  };
}
