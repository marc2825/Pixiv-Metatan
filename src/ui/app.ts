import type { InspectionResult } from '../metadata/types';
import { accessExplanation, Cooldown, cooldownResult, errorCode, errorDetail, localFallback, noteRateLimit } from '../network/failures';
import type { CancelRequest, InspectRequest } from '../network/inspector';
import { artworkIdFromUrl, getArtworkPages, type PixivPage } from '../pixiv/artworks';
import { createPageStore } from '../pixiv/page-store';
import { renderResult } from './result';
import { mountHoverPreview } from './preview';
import { inspectLocalFile } from './local-file';
import { STYLES } from './styles';

export interface AppDependencies {
  send: (message: InspectRequest | CancelRequest) => Promise<InspectionResult>;
  pages?: typeof getArtworkPages;
}

export function mountInspector(deps: AppDependencies): () => void {
  if (document.getElementById('metatan-root')) return () => {};
  const pageStore = createPageStore(deps.pages ?? getArtworkPages);
  const cooldown = new Cooldown();
  const host = document.createElement('div'); host.id = 'metatan-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = STYLES;
  const button = (label: string, className = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (className) b.className = className; return b; };
  const toggle = button('AI Metadata', 'toggle'); toggle.setAttribute('aria-controls', 'metatan-panel'); toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section'); panel.id = 'metatan-panel'; panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-labelledby', 'metatan-title');
  panel.tabIndex = -1; // focus target when the focused control becomes disabled mid-operation
  const title = document.createElement('h2'); title.id = 'metatan-title'; title.textContent = 'Pixiv-Metatan';
  const intro = document.createElement('p'); intro.className = 'intro';
  intro.textContent = '選んだ1枚だけを、押したときに検査します。画像・結果は外部へ送信・保存しません。原寸を取得できない場合はローカルファイルを検査できます（拡張機能のアイコンからも開けます）。';
  const label = document.createElement('label'); label.textContent = '検査する画像'; label.htmlFor = 'metatan-pages';
  const select = document.createElement('select'); select.id = 'metatan-pages';
  const buttons = document.createElement('div'); buttons.className = 'buttons';
  const refresh = button('画像一覧を取得');
  const scan = button('元画像を検査', 'primary');
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

  const selectedPage = () => pages.find(item => String(item.page) === select.value);
  const controls = () => {
    const focused = shadow.activeElement;
    toggle.hidden = artworkId === null;
    if (toggle.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    scan.disabled = !artworkId || !selectedPage()?.original || !!operation || !!listing;
    select.disabled = !pages.length || !!listing;
    refresh.disabled = !!operation || !!listing;
    fileButton.disabled = !!operation;
    cancel.disabled = !operation && !listing;
    // A disabled button drops focus to <body>; keep keyboard users inside the panel instead.
    if (focused instanceof HTMLButtonElement && focused.disabled && !panel.hidden) panel.focus({ preventScroll: true });
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
    cancelPending(); pageStore.clear(); artworkId = next; pages = []; loaded = false; inspected.clear(); fileContext = undefined;
    select.replaceChildren(); output.replaceChildren(); status.textContent = '作品が変わりました。「画像一覧を取得」を押してください。';
    controls();
  };
  const current = (token: number, id: string | null) => {
    navigation();
    return !disposed && !panel.hidden && version === token && artworkId === id;
  };
  // Take over Escape only when focus is in our UI (or nowhere); otherwise let pixiv handle it too.
  const focusedHere = () => document.activeElement === host || document.activeElement === document.body || !document.activeElement;
  const hide = () => { const returnFocus = focusedHere(); cancelPending(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); if (returnFocus) toggle.focus(); };
  const options = () => {
    const previous = select.value;
    select.replaceChildren(...pages.map(page => {
      const option = document.createElement('option'); option.value = String(page.page);
      option.textContent = `${page.page + 1}枚目${page.original ? '（元画像）' : '（検査対象外の形式）'}${inspected.has(page.page) ? '・検査済み' : ''}`;
      option.disabled = !page.original;
      return option;
    }));
    if (pages.some(page => String(page.page) === previous)) select.value = previous;
    else { const first = pages.find(page => page.original); if (first) select.value = String(first.page); }
  };
  async function populate() {
    navigation();
    if (!artworkId || listing || operation) return;
    const id = artworkId, token = ++version;
    const controller = new AbortController(); listing = controller; loaded = false;
    pages = []; select.replaceChildren(); output.replaceChildren(); controls(); status.textContent = '作品の画像一覧を取得中…';
    try {
      const next = await pageStore.load(id, controller.signal);
      if (!current(token, id)) return;
      pages = next; loaded = true; options();
      const skipped = pages.filter(page => !page.original).length;
      status.textContent = `${pages.length}枚。対象を選び「元画像を検査」を押してください。${skipped ? `${skipped}枚は検査対象外の形式（GIF・うごイラ等の可能性）です。` : ''}`;
    } catch (error) {
      if (current(token, id)) status.textContent = `${accessExplanation(errorCode(error), 'pages', errorDetail(error))} ${localFallback}`;
    } finally {
      if (listing === controller) listing = undefined;
      controls();
    }
  }
  toggle.addEventListener('click', () => {
    navigation(); if (!artworkId) return;
    hover.close();
    if (!panel.hidden) { hide(); return; }
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    fileButton.focus(); if (!loaded) void populate();
  });
  close.addEventListener('click', () => { hide(); toggle.focus(); });
  // Disabling the focused Inspect button can move focus outside the shadow root.
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || panel.hidden) return;
    if (focusedHere()) { event.preventDefault(); event.stopPropagation(); }
    hide();
  };
  document.addEventListener('keydown', escape, true);
  refresh.addEventListener('click', () => void populate());
  cancel.addEventListener('click', () => { cancelPending(); output.replaceChildren(); status.textContent = '検査を取り消しました。'; });
  select.addEventListener('change', () => { cancelPending(); output.replaceChildren(); status.textContent = '選択した画像を検査できます。'; });
  scan.addEventListener('click', () => void (async () => {
    navigation();
    const page = selectedPage();
    if (!artworkId || !page?.original || operation || listing) return;
    const id = artworkId, token = ++version;
    const wait = cooldown.remaining();
    if (wait) { renderResult(output, cooldownResult(wait)); status.textContent = '原寸の取得は待機中です。'; return; }
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: true };
    operation = op; controls(); output.replaceChildren(); status.textContent = '元画像を検査中…';
    try {
      // Artwork-page requests are bound to the artwork ID (the worker re-checks the live tab),
      // so a hash/query change on the same artwork does not cancel them.
      const result = await deps.send({ type: 'INSPECT_PIXIV_IMAGE', requestId: op.id, artworkId: id, page: page.page, url: page.original });
      noteRateLimit(cooldown, result);
      if (!current(token, id)) return;
      renderResult(output, result); status.textContent = '検査結果を表示しました。';
      if (result.status === 'found' || result.status === 'no-metadata') { inspected.add(page.page); options(); }
    } catch {
      if (current(token, id)) status.textContent = `拡張機能との通信に失敗しました（拡張の更新・再読み込み後はページを再読み込みしてください）。${localFallback}`;
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
      const result = await inspectLocalFile(selected, op.controller.signal);
      if (current(token, id)) {
        renderResult(output, result);
        status.textContent = 'ローカルファイルの検査結果です（表示中の作品と同じ画像かは確認していません）。';
      }
    } finally { file.value = ''; if (operation === op) operation = undefined; controls(); }
  })());
  const hover = mountHoverPreview(shadow, deps, () => {
    cancelPending(); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
  }, pageStore, cooldown);
  // One shared ticker for both UIs: URL observation, cache expiry and target liveness only.
  // It never requests endpoints or images. Hidden tabs are throttled by the browser.
  const tick = () => {
    if (disposed) return;
    // Some SPA frameworks remove unknown nodes; re-attach instead of silently disappearing.
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    navigation(); hover.tick();
  };
  const watch = window.setInterval(tick, 300);
  const navigationApi = (window as { navigation?: EventTarget }).navigation;
  navigationApi?.addEventListener('currententrychange', tick);
  document.addEventListener('visibilitychange', tick);
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) { destroy(); return; }
    // Keep the UI mount for BFCache restore, but discard results and pending work.
    cancelPending(); pages = []; loaded = false; inspected.clear();
    select.replaceChildren(); output.replaceChildren(); status.textContent = '';
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); controls();
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true; cancelPending(); hover.destroy(); window.clearInterval(watch);
    navigationApi?.removeEventListener('currententrychange', tick);
    document.removeEventListener('visibilitychange', tick);
    document.removeEventListener('keydown', escape, true); window.removeEventListener('pagehide', pageHide); host.remove();
  };
  window.addEventListener('pagehide', pageHide);
  controls();
  return destroy;
}
