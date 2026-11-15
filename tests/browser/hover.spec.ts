import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { originalUrl, pagePayload, png, pngWithText, previewUrl } from '../fixtures';

async function start(page: Page, options: { path?: string; count?: number; apiStatus?: number; imageStatus?: number; apiDelay?: number; imageDelay?: number; edge?: boolean } = {}) {
  const requests: string[] = [];
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }); };
  });
  await page.route('**/*', async route => {
    const url = route.request().url(); requests.push(url);
    if (route.request().isNavigationRequest()) {
      // Both hover targets must remain visible beside the floating panel. Hovering a
      // card covered by that panel targets the panel itself and cannot test switching.
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="ja"><title>Synthetic listing</title><style>body{font:14px system-ui;margin:24px;min-height:2400px}a.card{display:inline-block;margin:12px}a.card img{width:100px;height:100px;background:#678}@media(min-width:800px){a.card#b{margin-left:500px}}${options.edge ? 'a.card:first-of-type{position:fixed;right:8px;bottom:8px}' : ''}</style><h1>Synthetic pixiv listing</h1><a class="card" id="a" href="/artworks/123"><img src="${previewUrl()}" alt="Synthetic artwork 123"></a><a class="card" id="b" href="/artworks/456"><img src="${previewUrl('456')}" alt="Synthetic artwork 456"></a></html>` });
    }
    const api = /\/ajax\/illust\/(\d+)\/pages$/.exec(url);
    if (api) {
      if (options.apiDelay) await new Promise(resolve => setTimeout(resolve, options.apiDelay));
      return route.fulfill({ status: options.apiStatus ?? 200, json: pagePayload(api[1], options.count ?? 3, true) }).catch(() => {});
    }
    if (url.startsWith('https://i.pximg.net/img-original/')) {
      if (options.imageDelay) await new Promise(resolve => setTimeout(resolve, options.imageDelay));
      return route.fulfill({ status: options.imageStatus ?? 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: Buffer.from(pngWithText({ Software: 'NovelAI', Description: 'synthetic prompt\nsecond line', Comment: '{"seed":42}' })) }).catch(() => {});
    }
    if (url.startsWith('https://i.pximg.net/img-master/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from(png()) });
    throw new Error(`unexpected test request: ${url}`);
  });
  await page.goto(`https://www.pixiv.net${options.path ?? '/tags/synthetic/artworks'}`);
  await page.addScriptTag({ content: await readFile('.test-browser/harness.js', 'utf8') });
  return requests;
}
const originals = (requests: string[]) => requests.filter(url => url.includes('/img-original/'));
const apiRequests = (requests: string[]) => requests.filter(url => url.includes('/ajax/illust/'));

test('hover opens a multipage preview, stays open during transfer, uses wheel/buttons/keys and caches metadata', async ({ page }) => {
  const requests = await start(page);
  await page.locator('#a').hover();
  const preview = page.getByRole('region', { name: '作品プレビュー', exact: true });
  await expect(preview).toBeVisible(); await expect(preview.locator('.hover-counter')).toHaveText('1 / 3');
  expect(originals(requests)).toHaveLength(0);
  const stage = preview.locator('.preview-stage'); await stage.hover();
  await page.mouse.wheel(0, 120);
  await expect(preview.locator('.hover-counter')).toHaveText('2 / 3');
  await expect(preview.locator('img')).toHaveAttribute('src', previewUrl('123', 1));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await stage.evaluate(element => { for (let i = 0; i < 50; i++) element.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, cancelable: true })); });
  await expect(preview.locator('.hover-counter')).toHaveText('2 / 3');
  await stage.focus(); await page.keyboard.press('ArrowRight'); await expect(preview.locator('.hover-counter')).toHaveText('3 / 3');
  await expect(preview.getByRole('button', { name: '次の画像', exact: true })).toBeDisabled();
  await page.keyboard.press('ArrowLeft');
  await preview.getByRole('button', { name: 'Metadata', exact: true }).click();
  await expect(preview.getByLabel('プレビューの検査結果', { exact: true })).toContainText('作品 123 / 2枚目');
  expect(originals(requests)).toEqual([originalUrl('123', 1)]);
  await preview.getByRole('button', { name: '前の画像', exact: true }).click();
  await expect(preview.getByLabel('プレビューの検査結果', { exact: true })).toBeEmpty();
  await preview.getByRole('button', { name: '次の画像', exact: true }).click();
  await expect(preview.getByLabel('プレビューの検査結果', { exact: true })).toContainText('synthetic prompt');
  await preview.getByRole('button', { name: 'Metadata', exact: true }).click(); expect(originals(requests)).toHaveLength(1);
  expect(apiRequests(requests)).toHaveLength(1);
  await page.keyboard.press('Escape'); await expect(preview).toBeHidden(); await expect(page.locator('#a')).toBeFocused();
});

test('original 403 preserves display and enables an explicit local-file fallback in preview', async ({ page }) => {
  const requests = await start(page, { imageStatus: 403 }); await page.locator('#a').hover();
  const preview = page.locator('#pami-preview');
  await preview.getByRole('button', { name: 'Metadata', exact: true }).click();
  await expect(preview).toContainText('http-403');
  await expect(preview.locator('img')).toBeVisible();
  expect(await preview.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
  const picker = page.waitForEvent('filechooser'); await preview.getByRole('button', { name: 'ローカルファイルを検査', exact: true }).click();
  await (await picker).setFiles({ name: 'synthetic-local.png', mimeType: 'image/png', buffer: Buffer.from(png()) });
  await expect(preview).toContainText('ローカル: synthetic-local.png'); await expect(preview).toContainText('作品との一致は未確認');
  expect(originals(requests)).toHaveLength(1);
});

test('rapid hover, leaving, and SPA changes suppress stale artwork and requests', async ({ page }) => {
  const requests = await start(page, { apiDelay: 500 });
  await page.locator('#a').hover(); await expect(page.locator('#pami-preview')).toBeVisible();
  await page.locator('#b').hover(); await expect(page.locator('#pami-preview h2')).toHaveText('Synthetic artwork 456');
  await expect(page.locator('.hover-counter')).toHaveText('1 / 3');
  await expect(page.locator('#pami-preview img')).toHaveAttribute('src', previewUrl('456'));
  await page.mouse.move(10, 10); await expect(page.locator('#pami-preview')).toBeHidden();
  await page.locator('#b').hover(); await expect(page.locator('#pami-preview')).toBeVisible();
  await page.evaluate(() => history.pushState({}, '', '/users/789/bookmarks/artworks'));
  await expect(page.locator('#pami-preview')).toBeHidden();
  expect(originals(requests)).toHaveLength(0);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`viewport edge and narrow ${colorScheme} preview retains accessible single-page controls`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 }); await page.emulateMedia({ colorScheme });
    const requests = await start(page, { count: 1, edge: true }); await page.locator('#a').focus();
    const preview = page.locator('#pami-preview'); await expect(preview).toBeVisible();
    await expect(preview.locator('.hover-counter')).toHaveText('1 / 1');
    await page.keyboard.press('ArrowDown'); await expect(preview.locator('.preview-stage')).toBeFocused();
    await page.keyboard.press('Tab'); await expect(preview.getByRole('button', { name: 'Metadata', exact: true })).toBeFocused();
    await expect(preview.getByRole('button', { name: '次の画像', exact: true })).toBeHidden();
    const box = await preview.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360); expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    await page.screenshot({ path: `.test-browser/hover-${colorScheme}.png` });
    await page.keyboard.press('Escape'); await expect(preview).toBeHidden(); expect(originals(requests)).toHaveLength(0);
  });
}

test('429 pages denial leaves a thumbnail and does not repeat API calls on another hover', async ({ page }) => {
  const requests = await start(page, { apiStatus: 429 }); await page.locator('#a').hover();
  await expect(page.locator('#pami-preview')).toContainText('pixiv-pages-http-429');
  await expect(page.locator('#pami-preview img')).toBeVisible();
  await page.locator('#b').hover(); await expect(page.locator('#pami-preview h2')).toHaveText('Synthetic artwork 456');
  await expect(page.locator('#pami-preview')).toContainText('pixiv-pages-http-429');
  expect(apiRequests(requests)).toHaveLength(1); expect(originals(requests)).toHaveLength(0);
});
