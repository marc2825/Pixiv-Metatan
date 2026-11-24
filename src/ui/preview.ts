import { MemoryCache } from '../cache';
import { emptyResult, type InspectionResult } from '../metadata/types';
import { accessExplanation, Cooldown, cooldownResult, errorCode, errorDetail, failureReason, localFallback, noteRateLimit } from '../network/failures';
import { artworkIdFromUrl, getArtworkPages, type PixivPage } from '../pixiv/artworks';
import { createPageStore } from '../pixiv/page-store';
import { thumbnailFromTarget } from '../pixiv/thumbnail';
import type { AppDependencies } from './app';
import { icon } from './icons';
import { inspectLocalFile } from './local-file';
import { PageWheel, previewPosition } from './preview-controls';
import { renderResult } from './result';

/**
 * Sweeping across a grid opens previews in quick succession. When another preview opened within
 * SWEEP_WINDOW_MS, the pages request waits SWEEP_API_DELAY_MS more (the DOM thumbnail is shown at
 * once), so cards the pointer merely passes over do not each trigger a request (issue #14). A
 * deliberate first hover and cached artworks are not delayed.
 */
export const SWEEP_WINDOW_MS = 1000, SWEEP_API_DELAY_MS = 150;
/** Layout in CSS pixels: viewport margin, result sheet width, narrowest image column, control bar. */
const MARGIN = 8, SHEET_WIDTH = 340, MIN_STAGE = 280, BAR = 44;
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
const stableResult = (result: InspectionResult) => ['found', 'no-metadata', 'unsupported-format', 'parse-error', 'too-large'].includes(result.status);
const LOCAL_CONTEXT = '手元のファイルの結果です。表示中の作品と同じ画像かは確かめていません。';

/**
 * What the viewer shows. `hover`: a thumbnail in a listing (closes when the pointer leaves, until
 * the user acts). `artwork`: the artwork page's own button (stays open). Artwork requests are bound
 * to the artwork ID; hover requests to the exact page URL at the time of the click.
 */
interface Subject { mode: 'hover' | 'artwork'; artworkId: string; anchor: HTMLElement; image?: string; title?: string; author?: string }
interface Shown { key: string; result: InspectionResult; stable: boolean; context?: string }

export interface Viewer {
  close(returnFocus?: boolean): void;
  openArtwork(artworkId: string, from: HTMLElement): void;
  artworkOpen(): boolean;
  /** Driven by the app's shared ticker: URL check, cache expiry and target liveness. */
  tick(): void;
  destroy(): void;
}

/** Isolated UI. Hover requests only pages/derivatives; original bytes require 生成情報を見る. */
export function mountHoverPreview(shadow: ShadowRoot, deps: AppDependencies, store = createPageStore(deps.pages ?? getArtworkPages), cooldown = new Cooldown(), onChange: () => void = () => {}): Viewer {
  const results = new MemoryCache<InspectionResult>(8, 8 * 1024 * 1024, 120_000);
  const button = (label: string, className = '') => {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = className; return b;
  };
  const iconButton = (name: Parameters<typeof icon>[0], label: string, className: string) => {
    const b = button('', `icon-button ${className}`); b.setAttribute('aria-label', label); b.append(icon(name)); return b;
  };
  const panel = document.createElement('section'); panel.id = 'metatan-preview'; panel.className = 'hover-panel'; panel.hidden = true;
  panel.tabIndex = -1; // focus target when the focused control becomes disabled mid-operation
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', '作品プレビュー');
  const viewer = document.createElement('div'); viewer.className = 'viewer';
  // The card on the page already shows title and author; keep them for assistive technology only.
  const title = document.createElement('h2'); title.className = 'visually-hidden';
  const author = document.createElement('p'); author.className = 'hover-author visually-hidden';
  const stage = document.createElement('div'); stage.className = 'preview-stage'; stage.tabIndex = 0;
  stage.setAttribute('aria-label', '画像プレビュー。複数枚はホイールか左右キーでページを切り替えます');
  const imageSlot = document.createElement('div'); imageSlot.className = 'preview-slot';
  const imageStatus = document.createElement('span'); imageStatus.className = 'preview-loading'; imageStatus.setAttribute('role', 'status');
  stage.append(imageSlot, imageStatus);
  const bar = document.createElement('div'); bar.className = 'hover-bar';
  const previous = iconButton('previous', '前の画像', 'hover-previous');
  const next = iconButton('next', '次の画像', 'hover-next');
  const counter = document.createElement('span'); counter.className = 'hover-counter'; counter.setAttribute('aria-live', 'polite');
  const nav = document.createElement('div'); nav.className = 'hover-nav'; nav.append(previous, counter, next);
  const unavailable = document.createElement('span'); unavailable.className = 'hover-unavailable'; unavailable.textContent = 'このページは読めない形式です（GIF・うごイラなど）';
  const metadata = button('生成情報を見る', 'hover-metadata primary'); metadata.title = '表示中のページの原寸画像を1枚だけ読み込みます';
  const cancel = button('取り消し', 'hover-cancel');
  const closeButton = iconButton('close', 'プレビューを閉じる', 'hover-close');
  // Cancel appears to the left, so the main button stays under the pointer (a double click never cancels).
  bar.append(nav, unavailable, cancel, metadata, closeButton);
  const info = document.createElement('div'); info.className = 'hover-info'; info.setAttribute('role', 'status'); info.hidden = true;
  const infoText = document.createElement('p');
  const infoMore = document.createElement('details'); const infoSummary = document.createElement('summary'); infoSummary.textContent = 'くわしい理由';
  const infoDetail = document.createElement('p'); infoMore.append(infoSummary, infoDetail);
  info.append(infoText, infoMore);
  viewer.append(title, author, stage, bar, info);
  const sheet = document.createElement('section'); sheet.className = 'sheet'; sheet.hidden = true; sheet.tabIndex = -1;
  sheet.setAttribute('aria-label', '生成情報');
  const output = document.createElement('div'); output.className = 'hover-results';
  const sheetActions = document.createElement('div'); sheetActions.className = 'sheet-actions';
  const local = button('手元の画像で調べる', 'hover-local'); local.hidden = true;
  sheet.append(output, sheetActions);
  const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
  panel.append(viewer, sheet, file); shadow.append(panel);

  let subject: Subject | undefined, pendingTarget: HTMLAnchorElement | undefined;
  let pages: PixivPage[] = [], pageIndex = 0, generation = 0, disposed = false;
  let contextUrl = location.href;
  let listing: AbortController | undefined;
  let operation: { id: string; controller: AbortController; remote: boolean } | undefined;
  let fileContext: number | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined, closeTimer: ReturnType<typeof setTimeout> | undefined;
  let layoutFrame = 0, lastOpenAt = -Infinity, deferred = false;
  let pointerInPanel = false, pointerAnchor: HTMLAnchorElement | undefined;
  let suppressFocus = false, pinned = false, localOffered = false, pagesFailed = false;
  let shown: Shown | undefined;
  const wheel = new PageWheel();
  const host = shadow.host;
  const resultKey = () => `${subject?.artworkId}:${pageIndex}:${pages[pageIndex]?.original}`;
  const clearOpen = () => { clearTimeout(openTimer); pendingTarget = undefined; };
  const clearClose = () => clearTimeout(closeTimer);
  const statusLine = (text: string) => { const p = document.createElement('p'); p.className = 'sheet-status'; p.setAttribute('role', 'status'); p.textContent = text; return p; };

  const controls = () => {
    const focused = shadow.activeElement, page = pages[pageIndex];
    previous.hidden = next.hidden = counter.hidden = pages.length <= 1;
    previous.disabled = pageIndex <= 0; next.disabled = pageIndex >= pages.length - 1;
    counter.textContent = `${pageIndex + 1} / ${pages.length}`;
    unavailable.hidden = !page || !!page.original;
    // A result for this page is already in the sheet: the button would only repeat it.
    const showing = !sheet.hidden && shown?.key === resultKey() && shown.stable;
    metadata.hidden = (!!page && !page.original) || showing;
    metadata.disabled = !page?.original || !!listing || !!operation;
    cancel.hidden = !operation;
    local.hidden = !localOffered; local.disabled = !!operation;
    (sheet.hidden ? info : sheetActions).append(local);
    info.hidden = !pagesFailed;
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
    const anchor = subject?.anchor, wasOpen = !panel.hidden;
    clearOpen(); clearClose(); cancelPending();
    panel.hidden = true; sheet.hidden = true; pointerInPanel = false; pointerAnchor = undefined; deferred = false;
    pinned = false; localOffered = false; pagesFailed = false; shown = undefined;
    subject = undefined; pages = []; output.replaceChildren(); imageSlot.replaceChildren();
    infoText.textContent = ''; infoDetail.textContent = ''; file.value = ''; wheel.reset(); controls();
    if (returnFocus && anchor?.isConnected) { suppressFocus = true; anchor.focus(); suppressFocus = false; }
    if (wasOpen) onChange();
  }
  function navigation() {
    if (contextUrl === location.href) return;
    // The artwork page's viewer follows the artwork ID: a hash or query change keeps it open.
    if (subject?.mode === 'artwork' && artworkIdFromUrl(location.href) === subject.artworkId) { contextUrl = location.href; return; }
    // A new page is not a continuation of a sweep: reset the sweep timer with the caches.
    hide(); store.clear(); results.clear(); contextUrl = location.href; lastOpenAt = -Infinity;
  }
  function current(token: number): boolean {
    navigation();
    if (!subject) return false;
    if (subject.mode === 'hover' && thumbnailFromTarget(subject.anchor)?.artworkId !== subject.artworkId) { hide(); return false; }
    return !disposed && !panel.hidden && generation === token && subject.anchor.isConnected;
  }
  function aspect(): number {
    const page = pages[pageIndex];
    if (page?.width && page.height) return page.width / page.height;
    const img = imageSlot.querySelector('img');
    return img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  }
  /** Size the image to its aspect ratio, then place the sheet beside (or below) it without moving it. */
  function place() {
    if (panel.hidden || !subject) return;
    const anchor = subject.anchor.getBoundingClientRect();
    const offscreen = anchor.bottom < 0 || anchor.top > innerHeight || anchor.right < 0 || anchor.left > innerWidth;
    if (subject.mode === 'hover' && (!subject.anchor.isConnected || (offscreen && !pinned))) { hide(); return; }
    const vw = innerWidth, vh = innerHeight, open = !sheet.hidden, artwork = subject.mode === 'artwork';
    const side = open && vw >= MIN_STAGE + SHEET_WIDTH + MARGIN * 2;
    let maxW = Math.min(560, Math.max(MIN_STAGE, vw * 0.4), vw - MARGIN * 2);
    if (side) maxW = Math.min(maxW, vw - MARGIN * 2 - SHEET_WIDTH);
    const room = artwork ? anchor.top - MARGIN * 2 : vh - MARGIN * 2;
    let maxH = Math.max(160, Math.min(720, room - BAR));
    if (open && !side) maxH = Math.max(160, Math.min(maxH, room * 0.4));
    const ratio = aspect();
    let width = maxW, height = width / ratio;
    if (height > maxH) { height = maxH; width = height * ratio; }
    stage.style.width = `${Math.round(Math.min(maxW, Math.max(MIN_STAGE, width)))}px`;
    stage.style.height = `${Math.round(height)}px`;
    panel.dataset.layout = side ? 'side' : 'stack';
    sheet.style.height = side ? `${viewer.offsetHeight}px` : '';
    sheet.style.maxHeight = open && !side ? `${Math.max(160, room - viewer.offsetHeight)}px` : '';
    const viewerWidth = viewer.offsetWidth, total = panel.offsetWidth, panelHeight = panel.offsetHeight;
    let left: number, top: number, sheetLeft = false;
    if (artwork) {
      // Above the artwork page's button, aligned to the right edge; the sheet opens to the left.
      sheetLeft = side; left = vw - 16 - total; top = anchor.top - MARGIN - panelHeight;
    } else {
      ({ left, top } = previewPosition(anchor, side ? viewerWidth : total, panelHeight, vw, vh));
      if (side) {
        const fitsRight = left + viewerWidth + SHEET_WIDTH <= vw - MARGIN, fitsLeft = left - SHEET_WIDTH >= MARGIN;
        // Keep the sheet away from the card: on the far side of the image whenever it fits.
        sheetLeft = left >= anchor.right ? !fitsRight && fitsLeft : fitsLeft || !fitsRight;
        if (sheetLeft) left -= SHEET_WIDTH;
      }
    }
    panel.dataset.sheet = sheetLeft ? 'left' : 'right';
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - total));
    top = Math.max(MARGIN, Math.min(top, vh - MARGIN - panelHeight));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
  }
  function emptySheet() {
    const page = pages[pageIndex];
    output.replaceChildren(statusLine(page && !page.original ? 'このページは読めない形式です。' : 'このページの生成情報はまだ読み込んでいません。「生成情報を見る」を押すと読み込みます。'));
  }
  function display(key: string, result: InspectionResult, stable: boolean, context?: string) {
    shown = { key, result, stable, context };
    if (result.status === 'access-denied' || result.status === 'busy') localOffered = true;
    sheet.hidden = false; renderResult(output, result, context); controls(); place();
    // The button that started this was hidden or disabled (focus fell back to the panel): continue in the result.
    if (shadow.activeElement === panel) sheet.focus({ preventScroll: true });
  }
  /** Show what belongs to the current page: its result if known, otherwise an empty state. */
  function refreshSheet() {
    if (sheet.hidden) return;
    const key = resultKey();
    if (shown?.key === key) { renderResult(output, shown.result, shown.context); return; }
    const hit = results.get(key);
    if (hit) { shown = { key, result: hit, stable: true }; renderResult(output, hit); return; }
    shown = undefined; emptySheet();
  }
  function showImage() {
    const page = pages[pageIndex];
    const preview = page?.preview ?? (pageIndex === 0 ? subject?.image : undefined);
    imageSlot.replaceChildren(); imageStatus.hidden = false;
    imageStatus.textContent = preview ? '読み込み中…' : listing && !pages.length ? '画像の一覧を読み込み中…' : 'このページのプレビュー画像はありません。';
    if (!preview) return;
    const img = document.createElement('img'); img.className = 'preview-image'; img.alt = subject?.title ?? `作品 ${subject?.artworkId}`;
    img.decoding = 'async';
    // A normal image element uses the page's ordinary display path. No CORS byte read,
    // credentials API, referrer override, canvas extraction, blob URL or original fallback.
    // Both candidates are API derivatives for this page; the browser picks by width/DPR.
    if (page?.previewSmall && page.preview) { img.srcset = `${page.previewSmall} 540w, ${page.preview} 1200w`; img.sizes = '560px'; }
    img.addEventListener('load', () => { if (imageSlot.firstChild === img) { imageStatus.hidden = true; place(); } });
    img.addEventListener('error', () => {
      if (imageSlot.firstChild !== img) return;
      // The already-visible thumbnail is a safe fallback for page zero only.
      if (pageIndex === 0 && subject?.image && img.src !== subject.image) { img.removeAttribute('srcset'); img.src = subject.image; return; }
      imageStatus.textContent = 'プレビューを表示できません。作品ページで確かめてください。';
    });
    img.src = preview; imageSlot.append(img);
  }
  function switchPage(direction: number) {
    navigation(); if (!subject || !pages.length) return;
    const index = Math.max(0, Math.min(pageIndex + direction, pages.length - 1));
    if (index === pageIndex) return;
    cancelPending(); pageIndex = index; showImage(); refreshSheet(); controls(); place();
  }
  async function show(next: Subject) {
    navigation();
    hide();
    subject = next; contextUrl = location.href;
    // hide() forgot the pointer; the card that opened this preview is still under it.
    if (next.mode === 'hover' && next.anchor instanceof HTMLAnchorElement) pointerAnchor = next.anchor;
    pageIndex = 0; pages = []; panel.hidden = false; wheel.reset(); pinned = next.mode === 'artwork';
    title.textContent = next.title ?? `作品 ${next.artworkId}`;
    author.textContent = next.author ?? ''; author.hidden = !next.author;
    showImage(); controls(); place(); onChange();
    const sweeping = next.mode === 'hover' && Date.now() - lastOpenAt < SWEEP_WINDOW_MS;
    if (next.mode === 'hover') lastOpenAt = Date.now();
    await loadPages(next, sweeping);
  }
  /** The user is still looking at this preview (pointer on the card or panel, or focus). */
  const engaged = (target: Subject) => pinned || pointerAnchor === target.anchor || pointerInPanel || focusedInPreview();
  async function loadPages(target: Subject, delay: boolean) {
    deferred = false; pagesFailed = false;
    const token = generation, controller = new AbortController(); listing = controller; controls();
    const cached = store.peek(target.artworkId);
    try {
      if (!cached && delay) {
        await pause(SWEEP_API_DELAY_MS, controller.signal);
        // Passed over while sweeping: keep the thumbnail, skip the request until the user comes back.
        if (!engaged(target)) { deferred = true; return; }
      }
      const loaded = cached ?? await store.load(target.artworkId, controller.signal);
      if (!current(token)) return;
      pages = loaded; showImage(); refreshSheet();
    } catch (error) {
      if (current(token) && !controller.signal.aborted) {
        const code = errorCode(error);
        pagesFailed = true; localOffered = true;
        infoText.textContent = `画像の一覧を読み込めませんでした。${failureReason(code, 'pages')}`;
        infoDetail.textContent = `${accessExplanation(code, 'pages', errorDetail(error))} ${localFallback}`;
        if (!imageSlot.firstChild) imageStatus.textContent = 'プレビューを表示できません。作品ページで確かめてください。';
      }
    } finally { if (listing === controller) listing = undefined; controls(); place(); }
  }
  function scheduleOpen(anchor: HTMLAnchorElement) {
    clearClose();
    if (subject?.anchor === anchor || pendingTarget === anchor) return;
    clearOpen(); pendingTarget = anchor;
    const scheduledUrl = location.href;
    openTimer = setTimeout(() => {
      pendingTarget = undefined;
      // Re-read the link/image after the delay: lazy rendering may have recycled a card.
      const latest = thumbnailFromTarget(anchor);
      if (!disposed && !pinned && location.href === scheduledUrl && anchor.isConnected && latest) {
        void show({ mode: 'hover', artworkId: latest.artworkId, anchor: latest.anchor, image: latest.image, title: latest.title, author: latest.author });
      }
    }, 250);
  }
  const focusedInPreview = () => document.activeElement === host || (!!subject && document.activeElement === subject.anchor);
  function scheduleClose() {
    clearOpen(); clearClose();
    if (pinned) return;
    closeTimer = setTimeout(() => { if (!pinned && !pointerInPanel && !pointerAnchor && !focusedInPreview()) hide(); }, 200);
  }
  /** The user acted inside the preview: keep it open until ×, Esc or a click outside. */
  const pin = () => { pinned = true; clearClose(); };
  const over = (event: MouseEvent) => {
    if (event.composedPath().includes(host)) { clearClose(); return; }
    navigation();
    if (pinned) return;
    const thumbnail = thumbnailFromTarget(event.target);
    if (!thumbnail) return;
    pointerAnchor = thumbnail.anchor;
    if (deferred && !listing && subject?.anchor === thumbnail.anchor) void loadPages(subject, false);
    scheduleOpen(thumbnail.anchor);
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
    if (suppressFocus || pinned) return;
    if (event.composedPath().includes(host)) { clearClose(); return; }
    const thumbnail = thumbnailFromTarget(event.target); if (thumbnail) scheduleOpen(thumbnail.anchor);
  };
  const focusOut = () => scheduleClose();
  const outside = (event: Event) => {
    if (!panel.hidden && pinned && !event.composedPath().includes(host)) hide();
  };
  const keys = (event: KeyboardEvent) => {
    if (panel.hidden) return;
    if (event.key === 'Escape') {
      // Close in every case, but only take the key from pixiv when focus is ours (or nowhere).
      const ours = focusedInPreview() || document.activeElement === document.body || !document.activeElement;
      if (ours) { event.preventDefault(); event.stopPropagation(); }
      hide(ours); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowDown' && subject?.mode === 'hover' && document.activeElement === subject.anchor) {
      event.preventDefault(); event.stopPropagation(); stage.focus(); return;
    }
    // A closed root hides internal nodes from document-level composedPath().
    if (!focusedInPreview() || sheet.contains(shadow.activeElement)) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); switchPage(event.key === 'ArrowRight' ? 1 : -1); }
  };
  const layout = (event: Event) => {
    if (event.composedPath().includes(host) || panel.hidden || layoutFrame) return;
    // One layout read per frame, however many scroll events arrive.
    layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; navigation(); place(); });
  };
  const pageHide = () => { hide(); store.clear(); results.clear(); lastOpenAt = -Infinity; };
  panel.addEventListener('mouseenter', () => {
    pointerInPanel = true; pointerAnchor = undefined; clearOpen(); clearClose();
    if (deferred && !listing && subject) void loadPages(subject, false);
  });
  panel.addEventListener('mouseleave', () => { pointerInPanel = false; scheduleClose(); });
  stage.addEventListener('wheel', event => {
    navigation();
    if (!subject || pages.length <= 1 || event.ctrlKey || event.deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault(); event.stopPropagation();
    const direction = wheel.step(event.deltaY, event.deltaMode, performance.now());
    if (direction) switchPage(direction);
  }, { passive: false });
  previous.addEventListener('click', () => switchPage(-1)); next.addEventListener('click', () => switchPage(1));
  closeButton.addEventListener('click', () => hide(true));
  cancel.addEventListener('click', () => { cancelPending(); shown = undefined; if (!sheet.hidden) output.replaceChildren(statusLine('取り消しました。')); controls(); });
  metadata.addEventListener('click', () => void (async () => {
    navigation();
    const selected = pages[pageIndex]; if (!subject || !selected?.original || operation || listing) return;
    pin();
    const key = resultKey();
    const cached = results.get(key);
    if (cached) { display(key, cached, true); return; }
    const wait = cooldown.remaining();
    if (wait) { display(key, cooldownResult(wait), false); return; }
    const token = generation, id = subject.artworkId, artwork = subject.mode === 'artwork';
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: true }; operation = op;
    sheet.hidden = false; shown = undefined; output.replaceChildren(statusLine(`${pageIndex + 1}枚目の原寸画像を読み込んでいます…`)); controls(); place();
    try {
      const base = { type: 'INSPECT_PIXIV_IMAGE', requestId: op.id, artworkId: id, page: selected.page, url: selected.original } as const;
      const result = await deps.send(artwork ? base : { ...base, contextUrl });
      noteRateLimit(cooldown, result);
      if (!current(token) || op.controller.signal.aborted) return;
      const stable = stableResult(result);
      if (stable) results.set(key, result);
      display(key, result, stable);
    } catch {
      if (current(token)) display(key, emptyResult('access-denied', ['拡張機能と通信できませんでした。拡張を更新・再読み込みしたあとは、ページも再読み込みしてください。', localFallback]), false);
    } finally { if (operation === op) operation = undefined; controls(); place(); }
  })());
  local.addEventListener('click', () => {
    navigation(); if (!subject || operation) return;
    pin(); fileContext = generation; file.value = ''; file.click();
  });
  file.addEventListener('change', () => void (async () => {
    navigation(); const selected = file.files?.[0];
    if (!selected || !subject || operation || fileContext === undefined || !current(fileContext)) return;
    cancelPending(); const token = generation, key = resultKey();
    const op = { id: crypto.randomUUID(), controller: new AbortController(), remote: false }; operation = op;
    sheet.hidden = false; shown = undefined; output.replaceChildren(statusLine('手元のファイルを読み込んでいます…')); controls(); place();
    try {
      const result = await inspectLocalFile(selected, op.controller.signal);
      // User-selected files are not proof of correspondence to this artwork/page: never cached as one.
      if (current(token) && !op.controller.signal.aborted) display(key, result, false, LOCAL_CONTEXT);
    } finally { file.value = ''; if (operation === op) operation = undefined; controls(); place(); }
  })());
  document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
  document.addEventListener('focusin', focusIn); document.addEventListener('focusout', focusOut);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', keys, true);
  window.addEventListener('scroll', layout, true); window.addEventListener('resize', layout);
  window.addEventListener('popstate', navigation); window.addEventListener('pagehide', pageHide);
  controls();
  return {
    close: hide,
    openArtwork(artworkId, from) {
      navigation(); clearOpen();
      // show() opens the panel synchronously; the page list then loads in the background.
      void show({ mode: 'artwork', artworkId, anchor: from });
      stage.focus({ preventScroll: true });
    },
    artworkOpen: () => !panel.hidden && subject?.mode === 'artwork',
    tick() {
      if (disposed) return;
      navigation(); store.prune(); results.prune();
      if (subject?.mode === 'hover' && !subject.anchor.isConnected) hide();
    },
    destroy() {
      if (disposed) return;
      disposed = true; hide(); store.clear(); results.clear(); cancelAnimationFrame(layoutFrame);
      document.removeEventListener('mouseover', over); document.removeEventListener('mouseout', out);
      document.removeEventListener('focusin', focusIn); document.removeEventListener('focusout', focusOut);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keys, true);
      window.removeEventListener('scroll', layout, true); window.removeEventListener('resize', layout);
      window.removeEventListener('popstate', navigation); window.removeEventListener('pagehide', pageHide);
      panel.remove();
    },
  };
}
