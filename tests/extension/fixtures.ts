import { test as base, chromium, type BrowserContext, type Page, type Request, type Worker } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { InspectorDriver } from './driver';
import { originalUrl, pagePayload, png, pngWithText, previewUrl } from '../fixtures';

export interface ImageReply { status?: number; mime?: string; body?: Uint8Array; delayMs?: number; failure?: boolean }
export interface NetworkRecord { kind: 'document' | 'pages' | 'original' | 'preview' | 'other'; worker: boolean; configuredStatus?: number; status?: number; mime?: string; page?: number; outcome?: 'finished' | 'failed'; cookie?: boolean }
export interface TestExtension {
  context: BrowserContext; worker: Worker; records: NetworkRecord[]; unexpected: string[];
  replies: Map<number, ImageReply>; apiStatus: number; pageCount: number;
  open: (id?: string) => Promise<{ page: Page; driver: InspectorDriver }>;
  openListing: (path?: string) => Promise<{ page: Page; driver: InspectorDriver }>;
}

export const test = base.extend<{ extension: TestExtension }>({
  extension: async ({}, use, testInfo) => {
    const profile = await mkdtemp(join(tmpdir(), 'pami-mv3-test-'));
    let context: BrowserContext | undefined;
    try {
      const path = resolve('.output/chrome-mv3');
      const extensionArtifacts: Record<string, string> = {};
      for (const file of ['manifest.json', 'background.js', 'content-scripts/pixiv.js']) extensionArtifacts[file] = createHash('sha256').update(await readFile(join(path, file))).digest('hex');
      context = await chromium.launchPersistentContext(profile, {
        ...(process.env.PAMI_CHROME_PATH ? { executablePath: process.env.PAMI_CHROME_PATH } : { channel: 'chromium' }),
        headless: true, viewport: { width: 1100, height: 850 },
        args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
      });
      const activeContext = context;
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
      const replies = new Map<number, ImageReply>();
      const records: NetworkRecord[] = [], unexpected: string[] = [];
      const byRequest = new Map<Request, NetworkRecord>();
      context.on('response', response => {
        const record = byRequest.get(response.request());
        if (record) { record.status = response.status(); record.mime = response.headers()['content-type']; }
      });
      context.on('requestfinished', request => { const record = byRequest.get(request); if (record) record.outcome = 'finished'; });
      context.on('requestfailed', request => { const record = byRequest.get(request); if (record) record.outcome = 'failed'; });
      const extension: TestExtension = {
        context, worker, records, unexpected, replies, apiStatus: 200, pageCount: 2,
        async open(id = '123') {
          const page = await activeContext.newPage();
          await page.goto(`https://www.pixiv.net/artworks/${id}`);
          return { page, driver: await InspectorDriver.create(activeContext, page) };
        },
        async openListing(path = '/tags/synthetic/artworks') {
          const page = await activeContext.newPage();
          await page.goto(`https://www.pixiv.net${path}`);
          return { page, driver: await InspectorDriver.create(activeContext, page) };
        },
      };
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const fromWorker = !!request.serviceWorker();
        const record: NetworkRecord = { kind: 'other', worker: fromWorker };
        records.push(record); byRequest.set(request, record);
        if (request.isNavigationRequest() && url.origin === 'https://www.pixiv.net') {
          record.kind = 'document'; record.configuredStatus = 200;
          if (!/^\/artworks\//.test(url.pathname)) return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ja"><title>Synthetic MV3 listing</title><style>body{margin:30px;font:14px system-ui}a.card{display:inline-block;margin:20px}a.card img{width:100px;height:100px}</style><h1>Synthetic listing</h1><a id="a" class="card" href="/artworks/123"><img alt="Synthetic 123" src="${previewUrl()}"></a><a id="b" class="card" href="/artworks/456"><img alt="Synthetic 456" src="${previewUrl('456')}"></a></html>` });
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><head><title>Synthetic MV3 test</title></head><body><h1>Synthetic artwork, no external assets</h1></body></html>' });
        }
        const api = /^\/ajax\/illust\/([1-9]\d*)\/pages$/.exec(url.pathname);
        if (url.origin === 'https://www.pixiv.net' && api) {
          record.kind = 'pages'; record.configuredStatus = extension.apiStatus;
          return route.fulfill({ status: extension.apiStatus, json: pagePayload(api[1], extension.pageCount, true) });
        }
        const derivative = /_p(\d+)_master1200\.jpg$/.exec(url.pathname);
        if (url.origin === 'https://i.pximg.net' && derivative) {
          record.kind = 'preview'; record.page = Number(derivative[1]); record.configuredStatus = 200;
          return route.fulfill({ contentType: 'image/png', body: Buffer.from(png()) });
        }
        const image = /_p(\d+)\./.exec(url.pathname);
        if (url.origin === 'https://i.pximg.net' && image) {
          const page = Number(image[1]), reply = replies.get(page) ?? {};
          const status = reply.status ?? 200, mime = reply.mime ?? 'image/png';
          record.kind = 'original'; record.page = page;
          // Whether any cookie was sent. (Playwright interception sees requests before declarativeNetRequest
          // edits them, so the Referer set by the session rule is verified against the real server instead:
          // docs/evidence/live-referer-2026-11-22.json.)
          record.cookie = 'cookie' in await request.allHeaders();
          if (!reply.failure) record.configuredStatus = status;
          if (reply.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs));
          if (reply.failure) return route.abort('failed');
          return route.fulfill({ status, headers: { 'content-type': mime }, body: Buffer.from(reply.body ?? pngWithText({ Software: 'NovelAI', Description: 'synthetic prompt', Comment: '{"seed":42,"signed_hash":"fake"}' })) }).catch(() => {});
        }
        // Fail closed: no real pixiv/pximg or third-party traffic in this suite.
        unexpected.push(url.origin);
        return route.abort('blockedbyclient');
      });
      await use(extension);
      testInfo.annotations.push({ type: 'browser-version', description: context.browser()?.version() ?? 'unknown' });
      await testInfo.attach('sanitized-mv3-evidence', {
        contentType: 'application/json', body: Buffer.from(JSON.stringify({ mode: 'synthetic-mv3', extensionLoaded: true, extensionArtifacts, browser: context.browser()?.version(), records, unexpected }, null, 2)),
      });
    } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
  },
});
export { expect } from '@playwright/test';
export { originalUrl, png, pngWithText };
