import { InspectionError, MAX_IMAGE_BYTES, MAX_PAGES, readResponse, TIMEOUT_MS } from '../limits';
import { imageFormat, inspectImage } from '../metadata/inspect';
import { isRecord } from '../metadata/normalize';
import { emptyResult, type InspectionResult } from '../metadata/types';
import { artworkIdFromUrl, isPixivPage, validatePixivImageUrl } from '../pixiv/artworks';
import { accessExplanation, formatWait, localFallback, retryAfterMs } from './failures';

export interface InspectRequest {
  type: 'INSPECT_PIXIV_IMAGE'; requestId: string; artworkId: string; page: number; url: string;
  /** Exact top-level URL at the explicit Inspect click. Legacy requests remain artwork-only. */
  contextUrl?: string;
}
export interface CancelRequest { type: 'CANCEL_INSPECTION'; requestId: string }
export interface Sender { id?: string; url?: string; frameId?: number; tab?: { id?: number } }
interface Dependencies {
  extensionId: string;
  tabUrl: (tabId: number) => Promise<string | undefined>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** Awaited before the original fetch (the worker installs its Referer session rule here). */
  beforeFetch?: () => Promise<void>;
}

const fallback = `${localFallback}アクセス制限の回避や自動再試行は行いません。`;
function failure(error: unknown, timedOut: boolean, cancelled: boolean, retryAfter?: number): InspectionResult {
  if (timedOut) return { ...emptyResult('access-denied', ['画像の取得・解析がタイムアウトしました（15秒）。', fallback]), error: { layer: 'original', code: 'timeout' } };
  if (cancelled) return emptyResult('cancelled', ['検査を取り消しました。']);
  const code = error instanceof InspectionError ? error.code : 'network-error';
  if (code === 'too-large') return { ...emptyResult('too-large', ['原寸画像が安全上限（48 MiB）を超えるため読み込みを中止しました。', fallback]), error: { layer: 'original', code } };
  const wait = retryAfter !== undefined ? `あと約${formatWait(retryAfter)}は再取得しません。` : '';
  return {
    ...emptyResult('access-denied', [accessExplanation(code, 'original') + wait, fallback]),
    error: { layer: 'original', code, ...(retryAfter !== undefined ? { retryAfterMs: retryAfter } : {}) },
  };
}
function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value); }

/** Single global slot, held until fetch, body reader and parser have settled. */
export function createInspector(deps: Dependencies) {
  let active: { tabId: number; requestId: string; artworkId: string; contextUrl?: string; controller: AbortController } | undefined;
  let blockedUntil = 0;
  const trusted = (sender: Sender): sender is Sender & { tab: { id: number } } =>
    sender.id === deps.extensionId && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && sender.tab!.id! >= 0 && isPixivPage(sender.url ?? '');

  function handle(message: unknown, sender: Sender): Promise<InspectionResult> | undefined {
    if (!isRecord(message) || (message.type !== 'INSPECT_PIXIV_IMAGE' && message.type !== 'CANCEL_INSPECTION')) return;
    if (!trusted(sender) || !validRequestId(message.requestId)) return Promise.resolve(emptyResult('access-denied', ['許可されていない要求元・メッセージです。', fallback]));
    const tabId = sender.tab.id;
    if (message.type === 'CANCEL_INSPECTION') {
      if (active?.tabId === tabId && active.requestId === message.requestId) active.controller.abort();
      return Promise.resolve(emptyResult('cancelled', ['取り消し要求を受け付けました。']));
    }
    if (typeof message.artworkId !== 'string' || typeof message.url !== 'string' || typeof message.page !== 'number' || !Number.isInteger(message.page) || message.page < 0 || message.page >= MAX_PAGES) return Promise.resolve(emptyResult('access-denied', ['不正な画像指定です。', fallback]));
    if (message.contextUrl !== undefined && (typeof message.contextUrl !== 'string' || message.contextUrl.length > 4096 || !isPixivPage(message.contextUrl))) return Promise.resolve(emptyResult('access-denied', ['不正な操作コンテキストです。', fallback]));
    const contextUrl = message.contextUrl as string | undefined;
    const { artworkId, page, requestId } = message;
    let url: string;
    try { url = validatePixivImageUrl(message.url, artworkId, page); }
    catch (error) { return Promise.resolve(failure(error, false, false)); }
    if (active) return Promise.resolve(emptyResult('busy', ['別の画像を検査中です。完了または取り消し後にもう一度操作してください。']));
    if (Date.now() < blockedUntil) return Promise.resolve(failure(new InspectionError('http-429'), false, false, blockedUntil - Date.now()));
    const operation = { tabId, requestId, artworkId, contextUrl, controller: new AbortController() };
    const matchesContext = (currentUrl?: string) => isPixivPage(currentUrl ?? '') && (contextUrl !== undefined ? currentUrl === contextUrl : artworkIdFromUrl(currentUrl ?? '') === artworkId);
    // Acquire before the first await, including current-tab validation.
    active = operation;
    return run();

    async function run(): Promise<InspectionResult> {
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; operation.controller.abort(); }, deps.timeoutMs ?? TIMEOUT_MS);
      const signal = operation.controller.signal;
      try {
        // sender.url can predate an SPA transition. Query the current top-level tab.
        const currentUrl = await deps.tabUrl(tabId);
        if (!matchesContext(currentUrl)) throw new InspectionError('current-context-mismatch');
        await deps.beforeFetch?.();
        signal.throwIfAborted();
        const response = await (deps.fetcher ?? fetch)(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          if (response.status === 429) blockedUntil = Date.now() + retryAfterMs(response.headers.get('retry-after'));
          throw new InspectionError(`http-${response.status}`);
        }
        if (response.redirected) { void response.body?.cancel().catch(() => {}); throw new InspectionError('redirect-denied'); }
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mime ?? ''];
        if (!expected) { void response.body?.cancel().catch(() => {}); throw new InspectionError('unexpected-content-type'); }
        const bytes = await readResponse(response, MAX_IMAGE_BYTES, signal);
        if (imageFormat(bytes) !== expected) throw new InspectionError('content-type-mismatch');
        const result = await inspectImage(bytes, signal);
        signal.throwIfAborted();
        if (!matchesContext(await deps.tabUrl(tabId))) throw new InspectionError('current-context-mismatch');
        signal.throwIfAborted();
        return { ...result, source: { kind: 'pixiv', artworkId, page, url } };
      } catch (error) {
        const limited = error instanceof InspectionError && error.code === 'http-429' && Date.now() < blockedUntil;
        return failure(error, timedOut, signal.aborted, limited ? blockedUntil - Date.now() : undefined);
      } finally {
        clearTimeout(timer);
        if (active === operation) active = undefined;
      }
    }
  }
  return {
    handle,
    onNavigation(tabId: number, url?: string) {
      if (active?.tabId === tabId && (!url || (active.contextUrl !== undefined ? url !== active.contextUrl : artworkIdFromUrl(url) !== active.artworkId))) active.controller.abort();
    },
  };
}
