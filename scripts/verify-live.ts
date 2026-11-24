import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { InspectorDriver, ui } from '../tests/extension/driver.ts';

type Outcome = 'PASS' | 'FAIL' | 'NOT RUN';
interface Check { result: Outcome; reason?: string; status?: number; mime?: string }
interface Evidence {
  schemaVersion: number; mode: string; startedAt: string; finishedAt?: string; revision: string;
  browser?: string; extensionLoaded?: boolean; worktreeDirty: boolean; extensionArtifacts: Record<string, string>; signedIn: false; credentialsImported: false;
  interception: false; imageBytesStored: false; targetType: 'home' | 'artwork'; page: number;
  checks: Record<string, Check>; network: { kind: string; status: number; mime: string | null }[];
  originalRequests: number; notes: string[];
}
const { values } = parseArgs({ options: {
  url: { type: 'string' }, page: { type: 'string', default: '0' },
  browser: { type: 'string', default: 'chromium' },
  output: { type: 'string', default: '.verification/live-pixiv.json' },
  'local-file': { type: 'string' }, headed: { type: 'boolean', default: false }, help: { type: 'boolean' },
} });
if (values.help || !values.url) {
  console.log('Usage: npm run verify:live -- --url https://www.pixiv.net/artworks/ID --page 0 [--local-file /path/original.png] [--output .verification/live.json] [--browser chromium|msedge] [--headed]');
  console.log('Uses a new temporary profile, one explicit Inspect, no retries, no authentication import, and stores sanitized status evidence only. The home URL is accepted for connectivity-only checks.');
  process.exit(values.help ? 0 : 2);
}
const url = new URL(values.url);
const artwork = /^\/(?:[a-z]{2}\/)?artworks\/[1-9]\d{0,19}\/?$/.test(url.pathname);
const pageIndex = Number(values.page);
if (url.origin !== 'https://www.pixiv.net' || url.username || url.password || (!artwork && url.pathname !== '/') || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 999 || !['chromium', 'msedge'].includes(values.browser!)) throw new Error('invalid-test-target');
const checks = Object.fromEntries(['document', 'injection', 'pagesApi', 'original', 'formatAndResult', 'localFallback'].map(key => [key, { result: 'NOT RUN' as const }]));
const evidence: Evidence = {
  schemaVersion: 1, mode: 'live-pixiv', startedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  worktreeDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), extensionArtifacts: {},
  signedIn: false, credentialsImported: false, interception: false, imageBytesStored: false,
  targetType: artwork ? 'artwork' : 'home', page: pageIndex, checks, network: [], originalRequests: 0, notes: [],
};
const profile = await mkdtemp(join(tmpdir(), 'metatan-live-dev-'));
let context: BrowserContext | undefined;

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 18_000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read(); if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('verification-step-timeout');
}
/** Classify from the verdict sentence and the format line only; prompts and URLs are never recorded. */
async function classifyResult(driver: InspectorDriver): Promise<{ result: Outcome; reason: string }> {
  const title = await driver.summary();
  const format = /形式: ([A-Z]+)/.exec(await driver.text(ui.result))?.[1]?.toLowerCase() ?? 'unknown';
  if (['で生成したと書かれています', 'の生成情報が入っています', '生成ツールは書かれていません'].some(end => title.endsWith(end))) return { result: 'PASS', reason: `found:${format}` };
  if (title === '生成情報は見つかりませんでした') return { result: 'PASS', reason: `no-metadata:${format}` };
  if (title === '読めない形式です') return { result: 'PASS', reason: `unsupported-format:${format}` };
  return { result: 'FAIL', reason: 'inspection-failed-see-http-status' };
}
async function run(page: Page) {
  const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  const headers = response?.headers() ?? {};
  // Classify only from response headers. A bot challenge is recorded, never solved or evaded.
  const challenge = headers['cf-mitigated'] === 'challenge';
  evidence.checks.document = {
    result: response?.ok() ? 'PASS' : 'FAIL', status: response?.status(), mime: headers['content-type'],
    ...(challenge ? { reason: 'cloudflare-managed-challenge' } : {}),
  };
  if (!response?.ok()) {
    evidence.notes.push(challenge
      ? 'Document returned a Cloudflare managed challenge (cf-mitigated: challenge) to this automated browser profile. It was not solved or evaded; use the manual GUI procedure in a normal browser.'
      : 'Document denied or unavailable. No retry, API request, original request or bypass was attempted.');
    return;
  }
  const driver = await InspectorDriver.create(context!, page);
  evidence.checks.injection = { result: 'PASS', reason: 'production-closed-shadow-root' };
  if (!artwork) { evidence.notes.push('Connectivity only. No artwork or original selected.'); return; }
  await driver.click(ui.toggle);
  // The page list has loaded (or failed) when the main button is usable, a page is marked unreadable, or an error shows.
  await waitFor(async () => !(await driver.disabled(ui.scan)) || !(await driver.hidden('.hover-unavailable')) || !(await driver.hidden(ui.status)), ready => ready);
  const failed = !(await driver.hidden(ui.status));
  const count = failed ? 0 : await driver.hidden(ui.counter) ? 1 : Number(/\/ (\d+)$/.exec(await driver.text(ui.counter))?.[1] ?? 0);
  evidence.checks.pagesApi = count ? { result: 'PASS', reason: `candidate-count:${count}` } : { result: 'FAIL', reason: 'no-accessible-candidates' };
  if (count && pageIndex < count) {
    for (let i = 0; i < pageIndex; i++) await driver.click(ui.next); // Switching pages fetches no original.
    await driver.click(ui.scan); // Exactly one selected original, never a loop over pages.
    await waitFor(() => driver.summary(), title => title !== '');
    evidence.checks.formatAndResult = await classifyResult(driver);
    const original = evidence.network.find(record => record.kind === 'original');
    evidence.checks.original = { result: original?.status === 200 ? 'PASS' : 'FAIL', status: original?.status, mime: original?.mime ?? undefined };
  } else if (count) evidence.notes.push('Requested page is outside accessible candidate range. Inspect was not clicked.');
  if (values['local-file']) {
    // The local route is offered after a failure (pages API or original), as in the product.
    if (await driver.hidden(ui.file)) { evidence.notes.push('Local file not offered: nothing failed, so it was not used.'); return; }
    await waitFor(() => driver.disabled(ui.file), disabled => !disabled);
    await driver.localFile(resolve(values['local-file']));
    await waitFor(() => driver.text(ui.result), text => text.includes('手元のファイル'));
    evidence.checks.localFallback = await classifyResult(driver);
  }
}
try {
  const extension = resolve('.output/chrome-mv3');
  for (const file of ['manifest.json', 'background.js', 'content-scripts/pixiv.js']) evidence.extensionArtifacts[file] = createHash('sha256').update(await readFile(join(extension, file))).digest('hex');
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.METATAN_CHROME_PATH && values.browser === 'chromium' ? { executablePath: process.env.METATAN_CHROME_PATH } : { channel: values.browser }),
    headless: !values.headed,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  evidence.browser = context.browser()?.version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
  evidence.extensionLoaded = true;
  const workerUrl = worker.url();
  context.on('request', request => {
    if (request.serviceWorker()?.url() === workerUrl && request.url().startsWith('https://i.pximg.net/img-original/')) evidence.originalRequests++;
  });
  context.on('response', response => {
    const request = response.request(), target = new URL(response.url());
    const kind = request.serviceWorker()?.url() === workerUrl && target.origin === 'https://i.pximg.net' ? 'original'
      : target.origin === 'https://www.pixiv.net' && /^\/ajax\/illust\/\d+\/pages$/.test(target.pathname) ? 'pages' : null;
    if (kind) evidence.network.push({ kind, status: response.status(), mime: response.headers()['content-type'] ?? null });
  });
  await run(await context.newPage());
} catch (error) {
  // Never write an exception stack containing private URLs or local file paths.
  const code = error instanceof Error ? /net::ERR_[A-Z_]+/.exec(error.message)?.[0] ?? error.name : 'Error';
  evidence.checks.execution = { result: 'FAIL', reason: code };
  evidence.notes.push(`Verification stopped: ${code}`);
} finally {
  await context?.close(); await rm(profile, { recursive: true, force: true });
  evidence.finishedAt = new Date().toISOString();
  const output = resolve(values.output!); await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
process.exitCode = Object.values(evidence.checks).some(check => check.result === 'FAIL') || !evidence.extensionLoaded ? 1 : 0;
