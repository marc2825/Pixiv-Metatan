import { MemoryCache } from '../cache';
import { emptyResult, type InspectionResult } from '../metadata/types';
import { accessExplanation, Cooldown, cooldownResult, errorCode, errorDetail, localFallback, noteRateLimit } from '../network/failures';
import { getArtworkPages, type PixivPage } from '../pixiv/artworks';
import { createPageStore } from '../pixiv/page-store';
import { thumbnailFromTarget, type Thumbnail } from '../pixiv/thumbnail';
import type { AppDependencies } from './app';
import { inspectLocalFile } from './local-file';
import { PageWheel, previewPosition } from './preview-controls';
import { renderResult } from './result';

const stableResult = (result: InspectionResult) => ['found', 'no-metadata', 'unsupported-format', 'parse-error', 'too-large'].includes(result.status);

/** Isolated UI. Hover requests only pages/derivatives; original bytes require Metadata. */
export function mountHoverPreview(shadow: ShadowRoot, deps: AppDependencies, onOpen: () => void, store = createPageStore(deps.pages ?? getArtworkPages), cooldown = new Cooldown()) {
  const results = new MemoryCache<InspectionResult>(8, 8 * 1024 * 1024, 120_000);
  const button = (label: string, className = '') => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; return b;
  };
  const panel = document.createElement('section'); panel.id = 'pami-preview'; panel.className = 'hover-panel'; panel.hidden = true;
  panel.tabIndex = -1; // focus target when the focused control becomes disabled mid-operation
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '作品プレビュー');
  const header = document.createElement('div'); header.className = 'hover-header';
  const heading = document.createElement('div'); heading.className = 'hover-heading';
  const title = document.createElement('h2');
  const meta = document.createElement('p'); meta.className = 'hover-meta';
  const author = document.createElement('span'); author.className = 'hover-author';
  const separator = document.createTextNode(' · ');
  const link = document.createElement('a'); link.textContent = '作品ページを開く';
  meta.append(author, separator, link);
  const closeButton = button('×', 'hover-close'); closeButton.setAttribute('aria-label', 'プレビューを閉じる');
  heading.append(title, meta); header.append(heading, closeButton);
  const stage = document.createElement('div'); stage.className = 'preview-stage'; stage.tabIndex = 0;
  stage.setAttribute('aria-label', '画像プレビュー。複数枚はホイールまたは左右キーでページ切替');
  const imageSlot = document.createElement('div'); imageSlot.className = 'preview-slot';
  const imageStatus = document.createElement('span'); imageStatus.className = 'preview-loading'; imageStatus.setAttribute('role', 'status');
  stage.append(imageSlot, imageStatus);
  const toolbar = document.createElement('div'); toolbar.className = 'hover-toolbar';
  const previous = button('‹', 'hover-previous'); previous.setAttribute('aria-label', '前の画像');
  const next = button('›', 'hover-next'); next.setAttribute('aria-label', '次の画像');
  const counter = document.createElement('span'); counter.className = 'hover-counter'; counter.setAttribute('aria-live', 'polite');
  const metadata = button('Metadata', 'hover-metadata primary'); metadata.title = '表示中のページの原寸画像を1枚だけ取得して解析します';
  const cancel = button('取り消し', 'hover-cancel');
  toolbar.append(previous, counter, next, metadata, cancel);
  const info = document.createElement('p'); info.className = 'hover-info'; info.setAttribute('role', 'status');
  const output = document.createElement('div'); output.className = 'hover-results'; output.setAttribute('aria-label', 'プレビューの検査結果');
  const local = button('ローカルファイルを検査', 'hover-local');
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
  panel.append(header, stage, toolbar, info, output, local, file); shadow.append(panel);

  let target: Thumbnail | undefined, pendingTarget: Thumbnail | undefined;
  let pages: PixivPage[] = [], pageIndex = 0, generation = 0, disposed = false;
  let contextUrl = location.href;
  let listing: AbortController | undefined;
  let operation: { id: string; controller: AbortController; remote: boolean } | undefined;
  let fileContext: number | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined;
  let layoutFrame = 0;
  let pointerInPanel = false, pointerAnchor: HTMLAnchorElement | undefined;
  let suppressFocus = false;
  const wheel = new PageWheel();
  const host = shadow.host;
  const resultKey = () => `${target?.artworkId}:${pageIndex}:${pages[pageIndex]?.original}`;
  const clearOpen = () => { clearTimeout(openTimer); pendingTarget = undefined; };
  const clearClose = () => clearTimeout(closeTimer);
  const controls = () => {
    const focused = shadow.activeElement;
    previous.hidden = next.hidden = pages.length <= 1;
    previous.disabled = pageIndex <= 0; next.disabled = pageIndex >= pages.length - 1;
    counter.textContent = `${pageIndex + 1} / ${pages.length || '?'}`;
    metadata.disabled = !pages[pageIndex]?.original || !!listing || !!operation;
    cancel.hidden = !operation && !listing;
    local.disabled = !!operation;
    if (focused instanceof HTMLButtonElement && (focused.disabled || focused.hidden) && panel.contains(focused) && !panel.hidden) panel.focus({ preventScroll: true });
  };
  const cancelPending = () => {
    generation++; fileContext = undefined;
    listing?.abort(); listing = undefined;
    if (operation) {
      operation.controller.abort();
      if (operation.remote) void deps.send({ type: 'CANCEL_INSPECTION', requestId: operation.id }).catch(() => {});
    }
    controls();
  };
  function hide(returnFocus = false) {
    const anchor = target?.anchor;
    clearOpen(); clearClose(); cancelPending();
    panel.hidden = true; pointerInPanel = false; pointerAnchor = undefined;
    target = undefined; pages = []; output.replaceChildren(); imageSlot.replaceChildren();
    info.textContent = ''; file.value = ''; wheel.reset();
    if (returnFocus && anchor?.isConnected) { suppressFocus = true; anchor.focus(); suppressFocus = false; }
  }
  function navigation() {
    if (contextUrl !== location.href) { hide(); store.clear(); results.clear(); contextUrl = location.href; }
  }
  function current(token: number): boolean {
    navigation();
    if (target && thumbnailFromTarget(target.anchor)?.artworkId !== target.artworkId) { hide(); return false; }
    return !disposed && !panel.hidden && generation === token && !!target && target.anchor.isConnected;
  }
  function place() {
    if (panel.hidden || !target) return;
    const anchor = target.anchor.getBoundingClientRect();
    if (!target.anchor.isConnected || anchor.bottom < 0 || anchor.top > innerHeight || anchor.right < 0 || anchor.left > innerWidth) { hide(); return; }
    const { left, top } = previewPosition(anchor, panel.offsetWidth, panel.offsetHeight, innerWidth, innerHeight);
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
  }
  function pageInfo() {
    const page = pages[pageIndex];
    if (page && !page.original) return 'このページは検査対象外の形式です（GIF・うごイラ等の可能性）。プレビューのみ表示します。';
    return 'Metadataを押すと、このページの原寸画像1枚だけを取得して解析します。';
  }
  function showResult() {
    output.replaceChildren();
    const hit = results.get(resultKey());
    if (hit) { renderResult(output, hit); info.textContent = 'このページの検査結果（タブ内の一時キャッシュ、最長2分）'; }
    else info.textContent = pageInfo();
    place();
  }
  function showImage() {
    const page = pages[pageIndex];
    const preview = page?.preview ?? (pageIndex === 0 ? target?.image : undefined);
    imageSlot.replaceChildren(); imageStatus.hidden = false;
    imageStatus.textContent = preview ? 'プレビューを読み込み中…' : 'このページのプレビュー用URLがありません。作品ページで確認できます。';
    if (!preview) return;
    const img = document.createElement('img'); img.className = 'preview-image'; img.alt = target?.title ?? `作品 ${target?.artworkId}`;
    img.decoding = 'async';
    // A normal image element uses the page's ordinary display path. No CORS byte read,
    // credentials API, referrer override, canvas extraction, blob URL or original fallback.
    // Both candidates are API derivatives for this page; the browser picks by width/DPR.
    if (page?.previewSmall && page.preview) { img.srcset = `${page.previewSmall} 540w, ${page.preview} 1200w`; img.sizes = 'min(440px, calc(100vw - 16px))'; }
    img.addEventListener('load', () => { if (imageSlot.firstChild === img) imageStatus.hidden = true; });
    img.addEventListener('error', () => {
      if (imageSlot.firstChild !== img) return;
      // The already-visible thumbnail is a safe fallback for page zero only.
      if (pageIndex === 0 && target && img.src !== target.image) { img.removeAttribute('srcset'); img.src = target.image; return; }
      imageStatus.textContent = 'プレビューを表示できません。作品ページで確認してください。';
    });
    img.src = preview; imageSlot.append(img);
  }
  function switchPage(direction: number) {
    navigation(); if (!target || !pages.length) return;
    const index = Math.max(0, Math.min(pageIndex + direction, pages.length - 1));
    if (index === pageIndex) return;
    cancelPending(); pageIndex = index; showImage(); showResult(); controls();
  }
  async function show(thumbnail: Thumbnail) {
    navigation();
    hide(); onOpen();
    target = thumbnail; pointerAnchor = thumbnail.anchor; contextUrl = location.href;
    pageIndex = 0; pages = []; panel.hidden = false; wheel.reset();
    title.textContent = thumbnail.title ?? `作品 ${thumbnail.artworkId}`;
    author.textContent = thumbnail.author ?? ''; author.hidden = !thumbnail.author;
    separator.textContent = thumbnail.author ? ' · ' : '';
    link.href = `https://www.pixiv.net/artworks/${thumbnail.artworkId}`;
    showImage(); controls(); place(); info.textContent = '作品の画像一覧を取得中…';
    const token = generation, controller = new AbortController(); listing = controller; controls();
    try {
      const loaded = await store.load(thumbnail.artworkId, controller.signal);
      if (!current(token)) return;
      pages = loaded; showImage(); showResult();
    } catch (error) {
      if (current(token) && !controller.signal.aborted) info.textContent = `${accessExplanation(errorCode(error), 'pages', errorDetail(error))} ${localFallback}`;
    } finally { if (listing === controller) listing = undefined; controls(); place(); }
  }
  function scheduleOpen(thumbnail: Thumbnail) {
    clearClose();
    if (target?.anchor === thumbnail.anchor || pendingTarget?.anchor === thumbnail.anchor) return;
    clearOpen(); pendingTarget = thumbnail;
    const scheduledUrl = location.href;
    openTimer = setTimeout(() => {
      pendingTarget = undefined;
      // Re-read the link/image after the delay: lazy rendering may have recycled a card.
      const latest = thumbnailFromTarget(thumbnail.anchor);
      if (!disposed && location.href === scheduledUrl && thumbnail.anchor.isConnected && latest?.artworkId === thumbnail.artworkId) void show(latest);
    }, 250);
  }
  const focusedInPreview = () => document.activeElement === host || (!!target && document.activeElement === target.anchor);
  function scheduleClose() {
    clearOpen(); clearClose();
    closeTimer = setTimeout(() => { if (!pointerInPanel && !pointerAnchor && !focusedInPreview()) hide(); }, 200);
  }
  const over = (event: MouseEvent) => {
    if (event.composedPath().includes(host)) { clearClose(); return; }
    navigation();
    const thumbnail = thumbnailFromTarget(event.target);
    if (thumbnail) { pointerAnchor = thumbnail.anchor; scheduleOpen(thumbnail); }
  };
  const out = (event: MouseEvent) => {
    if (event.composedPath().includes(host)) return;
    const thumbnail = thumbnailFromTarget(event.target);
    if (!thumbnail || (event.relatedTarget instanceof Node && thumbnail.anchor.contains(event.relatedTarget))) return;
    pointerAnchor = undefined;
    if (event.relatedTarget === host) { clearOpen(); clearClose(); return; }
    scheduleClose();
  };
  const focusIn = (event: FocusEvent) => {
    if (suppressFocus) return;
    if (event.composedPath().includes(host)) { clearClose(); return; }
    const thumbnail = thumbnailFromTarget(event.target); if (thumbnail) scheduleOpen(thumbnail);
  };
  const focusOut = () => scheduleClose();
  const keys = (event: KeyboardEvent) => {
    if (panel.hidden) return;
    if (event.key === 'Escape') {
      // Close in every case, but only take the key from pixiv when focus is ours (or nowhere).
      const ours = focusedInPreview() || document.activeElement === document.body || !document.activeElement;
      if (ours) { event.preventDefault(); event.stopPropagation(); }
      hide(ours); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowDown' && document.activeElement === target?.anchor) {
      event.preventDefault(); event.stopPropagation(); stage.focus(); return;
    }
    // A closed root hides internal nodes from document-level composedPath().
    if (!focusedInPreview() || output.contains(shadow.activeElement)) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); switchPage(event.key === 'ArrowRight' ? 1 : -1); }
  };
  const layout = (event: Event) => {
    if (event.composedPath().includes(host) || panel.hidden || layoutFrame) return;
    // One layout read per frame, however many scroll events arrive.
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; navigation(); place(); });
  };
  const pageHide = () => { hide(); store.clear(); results.clear(); };
  panel.addEventListener('mouseenter', () => { pointerInPanel = true; pointerAnchor = undefined; clearOpen(); clearClose(); });
  panel.addEventListener('mouseleave', () => { pointerInPanel = false; scheduleClose(); });
  stage.addEventListener('wheel', event => {
    navigation();
    if (!target || pages.length <= 1 || event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault(); event.stopPropagation();
    const direction = wheel.step(event.deltaY, event.deltaMode, performance.now());
    if (direction) switchPage(direction);
  }, { passive: false });
  previous.addEventListener('click', () => switchPage(-1)); next.addEventListener('click', () => switchPage(1));
  closeButton.addEventListener('click', () => hide(true));
  cancel.addEventListener('click', () => { cancelPending(); output.replaceChildren(); info.textContent = '検査を取り消しました。'; });
  metadata.addEventListener('click', () => void (async () => {
    navigation();
    const selected = pages[pageIndex]; if (!target || !selected?.original || operation || listing) return;
    const cached = results.get(resultKey());
    if (cached) { renderResult(output, cached); info.textContent = 'このページの検査結果（タブ内の一時キャッシュ、最長2分）'; return; }
    const wait = cooldown.remaining();
    if (wait) { renderResult(output, cooldownResult(wait)); info.textContent = '原寸の取得は待機中です。'; place(); return; }
    const token = generation, id = target.artworkId, key = resultKey();
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: true }; operation = op;
    output.replaceChildren(); info.textContent = `${pageIndex + 1}枚目の原寸画像を取得・解析中…`; controls();
    try {
      const result = await deps.send({ type: 'INSPECT_PIXIV_IMAGE', requestId: op.id, artworkId: id, page: selected.page, url: selected.original, contextUrl });
      noteRateLimit(cooldown, result);
      if (!current(token) || op.controller.signal.aborted) return;
      if (stableResult(result)) results.set(key, result);
      renderResult(output, result);
      info.textContent = result.status === 'access-denied' ? '原寸画像を取得できませんでした。プレビューは引き続き使えます。' : '表示中のページの検査結果です。';
    } catch {
      if (current(token)) renderResult(output, emptyResult('access-denied', [`拡張機能との通信に失敗しました（拡張の更新・再読み込み後はページを再読み込みしてください）。${localFallback}`]));
    } finally { if (operation === op) operation = undefined; controls(); place(); }
  })());
  local.addEventListener('click', () => {
    navigation(); if (!target || operation) return;
    clearClose(); fileContext = generation; file.value = ''; file.click();
  });
  file.addEventListener('change', () => void (async () => {
    navigation(); const selected = file.files?.[0];
    if (!selected || !target || operation || fileContext === undefined || !current(fileContext)) return;
    cancelPending(); const token = generation;
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: false }; operation = op;
    output.replaceChildren(); info.textContent = 'ローカルファイルを解析中…'; controls();
    try {
      const result = await inspectLocalFile(selected, op.controller.signal);
      if (current(token) && !op.controller.signal.aborted) {
        // User-selected files are not proof of correspondence to this artwork/page.
        renderResult(output, result); info.textContent = 'ローカルファイルの結果（表示中の作品との一致は未確認）';
      }
    } finally { file.value = ''; if (operation === op) operation = undefined; controls(); place(); }
  })());
  document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
  document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut);
  document.addEventListener('keydown', keys, true);
  window.addEventListener('scroll', layout, true); window.addEventListener('resize', layout);
  window.addEventListener('popstate', navigation); window.addEventListener('pagehide', pageHide);
  controls();
  return {
    close: hide,
    /** Driven by the app's shared ticker: URL check, cache expiry and target liveness. */
    tick() {
      if (disposed) return;
      navigation(); store.prune(); results.prune();
      if (target && !target.anchor.isConnected) hide();
    },
    destroy() {
      if (disposed) return;
      disposed = true; hide(); store.clear(); results.clear(); cancelAnimationFrame(layoutFrame);
      document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('scroll', layout, true); window.removeEventListener('resize', layout);
      window.removeEventListener('popstate', navigation); window.removeEventListener('pagehide', pageHide);
      panel.remove();
    },
  };
}
