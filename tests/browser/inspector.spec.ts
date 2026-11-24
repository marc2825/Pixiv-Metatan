import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { originalUrl, pagePayload, png, pngWithText, text } from '../fixtures';

async function start(page: Page, opts: { apiStatus?: number; imageStatus?: number; slow?: boolean } = {}) {
  const requests: string[] = [];
  // Only test builds open the shadow root for standard accessibility locators.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }); };
  });
  await page.route('**/*', async route => {
    const url = route.request().url(); requests.push(url);
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"><head><title>Synthetic pixiv artwork</title></head><body><h1>Synthetic artwork</h1></body></html>' });
    if (/\/ajax\/illust\/\d+\/pages$/.test(url)) {
      const id = /illust\/(\d+)/.exec(url)![1]!;
      return route.fulfill({ status: opts.apiStatus ?? 200, contentType: 'application/json', body: JSON.stringify(pagePayload(id)) });
    }
    if (url.startsWith('https://i.pximg.net/')) {
      if (opts.slow) await new Promise(r => setTimeout(r, 600));
      return route.fulfill({ status: opts.imageStatus ?? 200, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' }, body: Buffer.from(pngWithText({ Software: 'NovelAI', Description: '<img src=x onerror=alert(1)>', Comment: '{"signed_hash":"fake","seed":42}' })) });
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
  await page.goto('https://www.pixiv.net/artworks/123');
  await page.addScriptTag({ content: await readFile('.test-browser/harness.js', 'utf8') });
  return requests;
}
const images = (requests: string[]) => requests.filter(url => url.startsWith('https://i.pximg.net/'));

const viewer = (page: Page) => page.getByRole('region', { name: '作品プレビュー', exact: true });
const sheet = (page: Page) => page.getByRole('region', { name: '生成情報', exact: true });
const scan = (page: Page) => viewer(page).getByRole('button', { name: '生成情報を見る', exact: true });
const local = (page: Page) => viewer(page).getByRole('button', { name: '手元の画像で調べる', exact: true });
const openButton = (page: Page) => page.getByRole('button', { name: 'この作品の生成情報', exact: true });

test('synthetic artwork page: no prefetch, one chosen page, safe text and an unverified signature', async ({ page }) => {
  const requests = await start(page);
  expect(requests).toHaveLength(1);
  await openButton(page).click();
  await expect(viewer(page)).toBeVisible(); await expect(viewer(page).locator('.hover-counter')).toHaveText('1 / 2');
  await expect(scan(page)).toBeEnabled();
  expect(images(requests)).toHaveLength(0);
  await viewer(page).getByRole('button', { name: '次の画像', exact: true }).click();
  await scan(page).dblclick();
  await expect(sheet(page).locator('.verdict-title')).toHaveText('NovelAIで生成したと書かれています');
  await expect(sheet(page).locator('[aria-current=step]')).toHaveText('署名あり・未確認');
  await expect(sheet(page)).toContainText('NovelAI電子署名: 未検証');
  expect(images(requests)).toEqual([originalUrl('123', 1)]);
  await expect(sheet(page).locator('img,script')).toHaveCount(0);
  await expect(sheet(page)).toContainText('<img src=x onerror=alert(1)>');
  await sheet(page).getByText('くわしい情報', { exact: true }).click();
  await sheet(page).getByText('生データ（重複・Stealth・EXIFを含む）', { exact: true }).click();
  await expect(sheet(page).locator('details.raw[open]')).toContainText('signed_hash');
});

test('denied original falls back to an explicitly chosen local compressed PNG', async ({ page }) => {
  const requests = await start(page, { imageStatus: 403 });
  await openButton(page).click();
  await scan(page).click();
  await expect(sheet(page)).toContainText('http-403');
  const picker = page.waitForEvent('filechooser');
  await local(page).click();
  await (await picker).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png(text('Software', 'NovelAI', 'zTXt'), text('Description', '青い猫\n二行目', 'iTXt', true))) });
  await expect(sheet(page)).toContainText('青い猫\n二行目');
  await expect(sheet(page)).toContainText('手元のファイル: synthetic.png');
  expect(images(requests)).toHaveLength(1);
});

test('artwork API denial allows local read; JPEG EXIF is parsed and truncated JPEG is a parse failure', async ({ page }) => {
  const requests = await start(page, { apiStatus: 429 });
  await openButton(page).click();
  await expect(viewer(page).locator('.hover-info')).toContainText('http-429');
  await expect(scan(page)).toBeDisabled();
  let picker = page.waitForEvent('filechooser');
  await local(page).click();
  // Written by AUTOMATIC1111's unchanged save_image_with_geninfo (see tests/reference/README.md).
  await (await picker).setFiles({ name: 'a1111-exif.jpg', mimeType: 'image/jpeg', buffer: await readFile('tests/reference/fixtures/a1111-exif.jpg') });
  await expect(sheet(page).locator('.verdict-title')).toHaveText('AUTOMATIC1111 / Forgeの生成情報が入っています');
  await expect(sheet(page)).toContainText('形式: JPEG');
  await expect(sheet(page)).not.toContainText('NovelAI電子署名');
  picker = page.waitForEvent('filechooser');
  await local(page).click();
  await (await picker).setFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 224]) });
  await expect(sheet(page).locator('.verdict-title')).toHaveText('データが壊れているため、読めませんでした');
  expect(images(requests)).toHaveLength(0);
});

test('native Chrome inflation stops a compressed text bomb and releases the UI', async ({ page }) => {
  const requests = await start(page, { apiStatus: 404 });
  await openButton(page).click();
  await expect(local(page)).toBeEnabled();
  const picker = page.waitForEvent('filechooser');
  await local(page).click();
  await (await picker).setFiles({ name: 'synthetic-bomb.png', mimeType: 'image/png', buffer: Buffer.from(png(text('Description', 'x'.repeat(2 * 1024 * 1024 + 1), 'zTXt'))) });
  await expect(sheet(page).locator('.verdict-title')).toHaveText('大きすぎるため、読むのをやめました');
  await expect(sheet(page)).toContainText('text-too-large');
  await expect(local(page)).toBeEnabled();
  expect(images(requests)).toHaveLength(0);
});

test('SPA transition aborts stale inspection and requires another explicit click', async ({ page }) => {
  const requests = await start(page, { slow: true });
  await openButton(page).click();
  await scan(page).click();
  await expect.poll(() => images(requests).length).toBe(1);
  await page.evaluate(() => history.pushState({}, '', '/artworks/456'));
  await expect(viewer(page)).toBeHidden();
  expect(requests.filter(url => url.includes('/ajax/'))).toHaveLength(1);
  await openButton(page).click();
  await expect(scan(page)).toBeEnabled();
  expect(requests.filter(url => url.includes('/ajax/'))).toHaveLength(2);
  expect(images(requests)).toHaveLength(1);
});

test('keyboard use and narrow dark layout with synthetic data', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 }); await page.emulateMedia({ colorScheme: 'dark' });
  await start(page); await openButton(page).focus(); await page.keyboard.press('Enter');
  await expect(viewer(page).locator('.preview-stage')).toBeFocused();
  await expect(scan(page)).toBeEnabled();
  // Stage → next page (previous is disabled on the first page) → the main button.
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(scan(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toContainText('未検証');
  const box = await viewer(page).boundingBox(); expect(box?.x).toBeGreaterThanOrEqual(0); expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(box?.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: '.test-browser/synthetic-dark-mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(viewer(page)).toBeHidden();
  await expect(openButton(page)).toBeFocused();
});
