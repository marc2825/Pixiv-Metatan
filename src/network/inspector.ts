import { InspectionError, MAX_IMAGE_BYTES, MAX_PAGES, readResponse, TIMEOUT_MS } from '../limits';
import { imageFormat, inspectImage } from '../metadata/inspect';
import { isRecord } from '../metadata/normalize';
import { emptyResult, type InspectionResult } from '../metadata/types';
import { artworkIdFromUrl, isPixivPage, validatePixivImageUrl } from '../pixiv/artworks';

export interface InspectRequest {
  type: 'INSPECT_PIXIV_IMAGE'; requestId: string; artworkId: string; page: number; url: string;
}
export interface CancelRequest { type: 'CANCEL_INSPECTION'; requestId: string }
export interface Sender { id?: string; url?: string; frameId?: number; tab?: { id?: number } }
interface Dependencies {
  extensionId: string;
  tabUrl: (tabId: number) => Promise<string | undefined>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const fallback = '取得できない場合は、pixivで正規に保存できる元画像を「ローカルファイルを検査」で選択してください。アクセス制限の回避や自動再試行は行いません。';
function failure(error: unknown, timedOut: boolean, cancelled: boolean): InspectionResult {
  if (timedOut) return emptyResult('access-denied', ['画像取得がタイムアウトしました（15秒）。', fallback]);
  if (cancelled) return emptyResult('cancelled', ['検査を取り消しました。']);
  const code = error instanceof InspectionError ? error.code : 'network-error';
  return emptyResult(code === 'too-large' ? 'too-large' : 'access-denied', [`画像を取得できませんでした: ${code}`, fallback]);
}
function validRequestId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value); }

/** Single global slot, held until fetch, body reader and parser have settled. */
export function createInspector(deps: Dependencies) {
  let active: { tabId: number; requestId: string; artworkId: string; controller: AbortController } | undefined;
  const trusted = (sender: Sender): sender is Sender & { tab: { id: number } } =>
    sender.id === deps.extensionId && sender.frameId === 0 && Number.isInteger(sender.tab?.id) && isPixivPage(sender.url ?? '');

  function handle(message: unknown, sender: Sender): Promise<InspectionResult> | undefined {
    if (!isRecord(message) || (message.type !== 'INSPECT_PIXIV_IMAGE' && message.type !== 'CANCEL_INSPECTION')) return;
    if (!trusted(sender) || !validRequestId(message.requestId)) return Promise.resolve(emptyResult('access-denied', ['許可されていない要求元・メッセージです。', fallback]));
    const tabId = sender.tab.id;
    if (message.type === 'CANCEL_INSPECTION') {
      if (active?.tabId === tabId && active.requestId === message.requestId) active.controller.abort();
      return Promise.resolve(emptyResult('cancelled', ['取り消し要求を受け付けました。']));
    }
    if (typeof message.artworkId !== 'string' || typeof message.url !== 'string' || typeof message.page !== 'number' || !Number.isInteger(message.page) || message.page < 0 || message.page >= MAX_PAGES) return Promise.resolve(emptyResult('access-denied', ['不正な画像指定です。', fallback]));
    const { artworkId, page, requestId } = message;
    let url: string;
    try { url = validatePixivImageUrl(message.url, artworkId, page); }
    catch (error) { return Promise.resolve(failure(error, false, false)); }
    if (active) return Promise.resolve(emptyResult('busy', ['別の画像を検査中です。完了または取り消し後にもう一度操作してください。']));
    const operation = { tabId, requestId, artworkId, controller: new AbortController() };
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
        if (artworkIdFromUrl(currentUrl ?? '') !== artworkId) throw new InspectionError('current-artwork-mismatch');
        signal.throwIfAborted();
        const response = await (deps.fetcher ?? fetch)(url, { signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new InspectionError(`http-${response.status}`); }
        if (response.redirected) { void response.body?.cancel().catch(() => {}); throw new InspectionError('redirect-denied'); }
        const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mime ?? ''];
        if (!expected) { void response.body?.cancel().catch(() => {}); throw new InspectionError('unexpected-content-type'); }
        const bytes = await readResponse(response, MAX_IMAGE_BYTES, signal);
        if (imageFormat(bytes) !== expected) throw new InspectionError('content-type-mismatch');
        const result = await inspectImage(bytes, signal);
        signal.throwIfAborted();
        if (artworkIdFromUrl((await deps.tabUrl(tabId)) ?? '') !== artworkId) throw new InspectionError('current-artwork-mismatch');
        signal.throwIfAborted();
        return { ...result, source: { kind: 'pixiv', artworkId, page, url } };
      } catch (error) {
        return failure(error, timedOut, signal.aborted);
      } finally {
        clearTimeout(timer);
        if (active === operation) active = undefined;
      }
    }
  }
  return {
    handle,
    onNavigation(tabId: number, url?: string) {
      if (active?.tabId === tabId && (!url || artworkIdFromUrl(url) !== active.artworkId)) active.controller.abort();
    },
  };
}
