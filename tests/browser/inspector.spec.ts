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

test('synthetic page: no prefetch, page selection, safe text and unverified signature', async ({ page }) => {
  const requests = await start(page);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'AI Metadata', exact: true }).click();
  await expect(page.getByLabel('検査する画像')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeEnabled();
  expect(images(requests)).toHaveLength(0);
  await page.getByLabel('検査する画像').selectOption('1');
  await page.getByRole('button', { name: '元画像を検査', exact: true }).dblclick();
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('メタデータから推定: novelai');
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('NovelAI電子署名: 未検証');
  expect(images(requests)).toEqual([originalUrl('123', 1)]);
  await expect(page.getByLabel('検査結果', { exact: true }).locator('img,script')).toHaveCount(0);
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('<img src=x onerror=alert(1)>');
  await page.getByText('RAWテキスト（重複・Stealth・EXIFを含む）', { exact: true }).click();
  await expect(page.locator('details[open]')).toContainText('signed_hash');
});

test('denied original falls back to an explicitly chosen local compressed PNG', async ({ page }) => {
  const requests = await start(page, { imageStatus: 403 });
  await page.getByRole('button', { name: 'AI Metadata', exact: true }).click();
  await page.getByRole('button', { name: '元画像を検査', exact: true }).click();
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('http-403');
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ローカルファイルを検査', exact: true }).click();
  await (await picker).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png(text('Software', 'NovelAI', 'zTXt'), text('Description', '青い猫\n二行目', 'iTXt', true))) });
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('青い猫\n二行目');
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('ローカル: synthetic.png');
  expect(images(requests)).toHaveLength(1);
});

test('artwork API denial allows local read; JPEG EXIF is parsed and truncated JPEG is a parse failure', async ({ page }) => {
  const requests = await start(page, { apiStatus: 429 });
  await page.getByRole('button', { name: 'AI Metadata', exact: true }).click();
  await expect(page.getByRole('status').first()).toContainText('http-429');
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeDisabled();
  let picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ローカルファイルを検査', exact: true }).click();
  // Written by AUTOMATIC1111's unchanged save_image_with_geninfo (see tests/reference/README.md).
  await (await picker).setFiles({ name: 'a1111-exif.jpg', mimeType: 'image/jpeg', buffer: await readFile('tests/reference/fixtures/a1111-exif.jpg') });
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('テキスト情報あり / jpeg / メタデータから推定: a1111-forge');
  await expect(page.getByLabel('検査結果', { exact: true })).not.toContainText('NovelAI電子署名');
  picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ローカルファイルを検査', exact: true }).click();
  await (await picker).setFiles({ name: 'synthetic.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([255, 216, 255, 224]) });
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('解析失敗 / jpeg');
  expect(images(requests)).toHaveLength(0);
});

test('native Chrome inflation stops a compressed text bomb and releases the UI', async ({ page }) => {
  const requests = await start(page);
  await page.getByRole('button', { name: 'AI Metadata', exact: true }).click();
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeEnabled();
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ローカルファイルを検査', exact: true }).click();
  await (await picker).setFiles({ name: 'synthetic-bomb.png', mimeType: 'image/png', buffer: Buffer.from(png(text('Description', 'x'.repeat(2 * 1024 * 1024 + 1), 'zTXt'))) });
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('安全上限超過');
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('text-too-large');
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeEnabled();
  expect(images(requests)).toHaveLength(0);
});

test('SPA transition aborts stale inspection and requires another explicit listing', async ({ page }) => {
  const requests = await start(page, { slow: true });
  await page.getByRole('button', { name: 'AI Metadata', exact: true }).click();
  await page.getByRole('button', { name: '元画像を検査', exact: true }).click();
  await expect.poll(() => images(requests).length).toBe(1);
  await page.evaluate(() => history.pushState({}, '', '/artworks/456'));
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').first()).toContainText('作品が変わりました');
  await expect(page.getByLabel('検査結果', { exact: true })).toBeEmpty();
  expect(requests.filter(url => url.includes('/ajax/'))).toHaveLength(1);
  await page.getByRole('button', { name: '画像一覧を取得', exact: true }).click();
  await expect(page.getByRole('button', { name: '元画像を検査', exact: true })).toBeEnabled();
  expect(requests.filter(url => url.includes('/ajax/'))).toHaveLength(2);
  expect(images(requests)).toHaveLength(1);
});

test('keyboard close and narrow dark layout with synthetic data', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 }); await page.emulateMedia({ colorScheme: 'dark' });
  await start(page); await page.getByRole('button', { name: 'AI Metadata', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'ローカルファイルを検査', exact: true })).toBeFocused();
  const box = await page.locator('#metatan-panel').boundingBox(); expect(box?.x).toBeGreaterThanOrEqual(0); expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: '元画像を検査', exact: true }).click();
  await expect(page.getByLabel('検査結果', { exact: true })).toContainText('未検証');
  await page.screenshot({ path: '.test-browser/synthetic-dark-mobile.png' });
  await page.keyboard.press('Escape'); await expect(page.locator('#metatan-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'AI Metadata', exact: true })).toBeFocused();
});
