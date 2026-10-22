import { inspectImage } from '../src/metadata/inspect';
import { validatePixivImageUrl } from '../src/pixiv/artworks';
import type { InspectionResult } from '../src/metadata/types';

/** MV3 service worker: image fetching requires explicit host permissions.
 * pixiv may still reject hotlink-style requests (403); do NOT bypass with
 * forged headers, proxies, credential extraction, or external scraping services.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: unknown, sender): Promise<InspectionResult> | undefined => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'INSPECT_PIXIV_IMAGE') return;
    const senderUrl = sender.url ?? sender.tab?.url ?? '';
    if (!/^https:\/\/www\.pixiv\.net\/artworks\/\d+/.test(senderUrl)) {
      return Promise.resolve({
        status: 'access-denied', format: 'other', generator: 'unknown', confidence: 'unknown',
        novelaiSignature: 'not-checked', fields: {}, rawTextChunks: {}, notes: ['要求元がpixiv作品ページではありません。'],
      });
    }
    return (async () => {
      try {
        if (!('url' in message) || typeof message.url !== 'string') throw new Error('invalid-url');
        const url = validatePixivImageUrl(message.url);
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 15_000);
        try {
          const response = await fetch(url, { signal: abort.signal, credentials: 'omit', redirect: 'error' });
          if (!response.ok) throw new Error(`http-${response.status}`);
          const length = Number(response.headers.get('content-length'));
          if (length > 48 * 1024 * 1024) throw new Error('too-large');
          // Initial skeleton: arrayBuffer can use >48MiB before rejection if no content-length.
          // Codex must implement streamed size limits before release.
          const bytes = new Uint8Array(await response.arrayBuffer());
          return inspectImage(bytes);
        } finally { clearTimeout(timer); }
      } catch (error) {
        return {
          status: 'access-denied', format: 'other', generator: 'unknown', confidence: 'unknown',
          novelaiSignature: 'not-checked', fields: {}, rawTextChunks: {},
          notes: ['画像の取得に失敗しました。ファイルから読み込む方法をご利用ください。', String(error)],
        };
      }
    })();
  });
});
