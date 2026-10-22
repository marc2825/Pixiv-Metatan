import { InspectionError, MAX_IMAGE_BYTES, readBounded } from '../limits';
import { inspectImage } from '../metadata/inspect';
import { emptyResult, type InspectionResult } from '../metadata/types';
import type { CancelRequest, InspectRequest } from '../network/inspector';
import { artworkIdFromUrl, getArtworkPages, type PixivPage } from '../pixiv/artworks';
import { renderResult } from './result';

export interface AppDependencies {
  send: (message: InspectRequest | CancelRequest) => Promise<InspectionResult>;
  pages?: typeof getArtworkPages;
}
const fallback = '取得できない場合は、pixivで正規に保存できる元画像を「ローカルファイルを検査」で選択してください。';

export function mountInspector(deps: AppDependencies): () => void {
  if (document.getElementById('pami-extension-root')) return () => {};
  const host = document.createElement('div'); host.id = 'pami-extension-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:light dark}
    *{box-sizing:border-box} button,select,input{font:inherit} button,select,summary{cursor:pointer}
    .toggle{position:fixed;right:16px;bottom:20px;z-index:2147483646;background:#202b3b;color:white;border:0;border-radius:999px;padding:12px 18px;font:600 13px system-ui;box-shadow:0 3px 20px #0004}
    .panel{position:fixed;right:16px;bottom:76px;z-index:2147483646;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 100px);overflow:auto;background:#fff;color:#172435;border:1px solid #bdc5d0;border-radius:14px;padding:16px;font:13px/1.5 system-ui;box-shadow:0 8px 30px #0004;overflow-wrap:anywhere}
    [hidden]{display:none!important}.buttons{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    button{padding:7px 10px;border:1px solid #8996a7;border-radius:8px;background:#fff;color:#172435}
    button:disabled{opacity:.55;cursor:default} :focus-visible{outline:3px solid #1686ec;outline-offset:3px}
    select{width:100%;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:8px;border-radius:6px;max-height:200px;overflow:auto}
    h4{margin:12px 0 4px}details{margin:12px 0}summary{font-weight:600}h2{font-size:15px;margin:0}
    @media(prefers-color-scheme:dark){.panel{background:#19222e;color:#edf1f7;border-color:#66748a}button,select{background:#263448;color:#edf1f7}pre{background:#0f1823}}
  `;
  const button = (label: string) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; return b; };
  const toggle = button('AI Metadata'); toggle.className = 'toggle'; toggle.setAttribute('aria-controls', 'pami-panel'); toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section'); panel.id = 'pami-panel'; panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-labelledby', 'pami-title');
  const title = document.createElement('h2'); title.id = 'pami-title'; title.textContent = 'pixiv AI Metadata Inspector';
  const intro = document.createElement('p'); intro.textContent = `選択した1枚だけを検査します。画像・結果は外部送信・保存しません。${fallback}`;
  const label = document.createElement('label'); label.textContent = '検査する画像'; label.htmlFor = 'pami-pages';
  const select = document.createElement('select'); select.id = 'pami-pages';
  const buttons = document.createElement('div'); buttons.className = 'buttons';
  const refresh = button('画像一覧を取得');
  const scan = button('元画像を検査');
  const fileButton = button('ローカルファイルを検査');
  const cancel = button('取り消し');
  const close = button('閉じる');
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
  const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const output = document.createElement('div'); output.setAttribute('aria-label', '検査結果');
  buttons.append(scan, fileButton, cancel, refresh, close);
  panel.append(title, intro, label, select, buttons, file, status, output);
  shadow.append(style, toggle, panel);
  document.documentElement.append(host);

  let artworkId = artworkIdFromUrl(location.href);
  let version = 0, disposed = false, loaded = false;
  let pages: PixivPage[] = [];
  const inspected = new Set<number>();
  let listing: AbortController | undefined;
  let operation: { id: string; controller: AbortController; remote: boolean } | undefined;
  let fileContext: { version: number; artworkId: string | null } | undefined;

  const controls = () => {
    toggle.hidden = artworkId === null;
    if (toggle.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    scan.disabled = !artworkId || !pages.length || !!operation || !!listing;
    select.disabled = !pages.length || !!listing;
    refresh.disabled = !!operation || !!listing;
    fileButton.disabled = !!operation;
    cancel.disabled = !operation && !listing;
  };
  const cancelPending = () => {
    version++;
    listing?.abort(); listing = undefined;
    if (operation) {
      operation.controller.abort();
      if (operation.remote) void deps.send({ type: 'CANCEL_INSPECTION', requestId: operation.id }).catch(() => {});
    }
    controls();
  };
  const navigation = () => {
    const next = artworkIdFromUrl(location.href);
    if (next === artworkId) return;
    cancelPending(); artworkId = next; pages = []; loaded = false; inspected.clear(); fileContext = undefined;
    select.replaceChildren(); output.replaceChildren(); status.textContent = '作品が変わりました。「画像一覧を取得」を押してください。';
    controls();
  };
  const current = (token: number, id: string | null) => {
    navigation();
    return !disposed && !panel.hidden && version === token && artworkId === id;
  };
  const hide = () => { cancelPending(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); };
  const options = () => {
    const previous = select.value;
    select.replaceChildren(...pages.map(page => {
      const option = document.createElement('option'); option.value = String(page.page);
      option.textContent = `${page.page + 1}枚目（元画像）${inspected.has(page.page) ? '・検査済み' : ''}`;
      return option;
    }));
    if (pages.some(page => String(page.page) === previous)) select.value = previous;
  };
  async function populate() {
    navigation();
    if (!artworkId || listing || operation) return;
    const id = artworkId, token = ++version;
    const controller = new AbortController(); listing = controller; loaded = false;
    pages = []; select.replaceChildren(); output.replaceChildren(); controls(); status.textContent = '作品の画像一覧を取得中…';
    try {
      const next = await (deps.pages ?? getArtworkPages)(id, controller.signal);
      if (!current(token, id)) return;
      pages = next; loaded = true; options();
      status.textContent = `${pages.length}枚。対象を選び「元画像を検査」を押してください。`;
    } catch (error) {
      if (current(token, id)) status.textContent = `作品情報を取得できませんでした: ${error instanceof InspectionError ? error.code : '通信または応答のエラー'}。${fallback}`;
    } finally {
      if (listing === controller) listing = undefined;
      controls();
    }
  }
  toggle.addEventListener('click', () => {
    navigation(); if (!artworkId) return;
    if (!panel.hidden) { hide(); return; }
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    fileButton.focus(); if (!loaded) void populate();
  });
  close.addEventListener('click', hide);
  // Disabling the focused Inspect button can move focus outside the shadow root.
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); event.stopPropagation(); hide(); }
  };
  document.addEventListener('keydown', escape, true);
  refresh.addEventListener('click', () => void populate());
  cancel.addEventListener('click', () => { cancelPending(); output.replaceChildren(); status.textContent = '検査を取り消しました。'; });
  select.addEventListener('change', () => { cancelPending(); output.replaceChildren(); status.textContent = '選択した画像を検査できます。'; });
  scan.addEventListener('click', () => void (async () => {
    navigation();
    const page = pages.find(item => String(item.page) === select.value);
    if (!artworkId || !page || operation || listing) return;
    const id = artworkId, token = ++version;
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: true };
    operation = op; controls(); output.replaceChildren(); status.textContent = '元画像を検査中…';
    try {
      const result = await deps.send({ type: 'INSPECT_PIXIV_IMAGE', requestId: op.id, artworkId: id, page: page.page, url: page.original });
      if (!current(token, id)) return;
      renderResult(output, result); status.textContent = '検査結果を表示しました。';
      if (result.status === 'found' || result.status === 'no-metadata') { inspected.add(page.page); options(); }
    } catch {
      if (current(token, id)) status.textContent = `拡張機能との通信に失敗しました。${fallback}`;
    } finally { if (operation === op) operation = undefined; controls(); }
  })());
  fileButton.addEventListener('click', () => {
    navigation(); if (operation || !artworkId) return;
    fileContext = { version, artworkId }; file.value = ''; file.click();
  });
  file.addEventListener('change', () => void (async () => {
    navigation();
    const selected = file.files?.[0];
    if (!selected || operation || !artworkId || !fileContext || !current(fileContext.version, fileContext.artworkId)) return;
    cancelPending();
    const id = artworkId, token = version;
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: false };
    operation = op; controls(); output.replaceChildren(); status.textContent = 'ローカルファイルを検査中…';
    try {
      if (selected.size > MAX_IMAGE_BYTES) throw new InspectionError('too-large');
      const bytes = await readBounded(selected.stream(), MAX_IMAGE_BYTES, op.controller.signal);
      const result = await inspectImage(bytes, op.controller.signal);
      if (current(token, id)) {
        renderResult(output, { ...result, source: { kind: 'local', name: selected.name } });
        status.textContent = 'ローカルファイルの検査結果を表示しました。';
      }
    } catch (error) {
      if (current(token, id)) {
        renderResult(output, emptyResult(error instanceof InspectionError && error.code === 'too-large' ? 'too-large' : 'parse-error', ['ファイルを読み込めませんでした。上限は48 MiBです。']));
        status.textContent = 'ローカルファイルの検査に失敗しました。';
      }
    } finally { file.value = ''; if (operation === op) operation = undefined; controls(); }
  })());
  // URL observation only: no automatic endpoint or image requests on navigation.
  const watch = window.setInterval(() => { if (!host.isConnected) destroy(); else navigation(); }, 300);
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) { destroy(); return; }
    // Keep the UI mount for BFCache restore, but discard results and pending work.
    cancelPending(); pages = []; loaded = false; inspected.clear();
    select.replaceChildren(); output.replaceChildren(); status.textContent = '';
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); controls();
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true; cancelPending(); window.clearInterval(watch);
    document.removeEventListener('keydown', escape, true); window.removeEventListener('pagehide', pageHide); host.remove();
  };
  window.addEventListener('pagehide', pageHide);
  controls();
  return destroy;
}
