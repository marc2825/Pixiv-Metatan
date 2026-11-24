import { test, expect, png } from './fixtures';
import { previewUrl } from '../fixtures';

const panel = '#metatan-preview', scan = '.hover-metadata', output = '.hover-results', counter = '.hover-counter';

for (const path of ['/tags/synthetic/artworks', '/ranking.php?mode=daily', '/users/456', '/users/456/bookmarks/artworks', '/bookmark_new_illust.php']) {
  test(`production isolated hover and worker inspection from ${path}`, async ({ extension }) => {
    const { page, driver } = await extension.openListing(path);
    await page.locator('#a').hover(); await expect.poll(() => driver.hidden(panel)).toBe(false);
    await expect.poll(() => driver.disabled(scan)).toBe(false);
    expect(await driver.text(counter)).toBe('1 / 2');
    expect(extension.records.filter(record => record.kind === 'original')).toHaveLength(0);
    await driver.click('.hover-next'); expect(await driver.text(counter)).toBe('2 / 2');
    expect(await driver.attribute('#metatan-preview img', 'src')).toBe(previewUrl('123', 1));
    await driver.click(scan); await expect.poll(() => driver.text(output)).toContain('作品 123 の 2枚目');
    expect(extension.records.filter(record => record.kind === 'original')).toMatchObject([{ worker: true, page: 1, status: 200 }]);
    await driver.click('.hover-previous'); expect(await driver.text(output)).toContain('まだ読み込んでいません');
    await driver.click('.hover-next'); expect(await driver.text(output)).toContain('作品 123 の 2枚目');
    expect(await driver.hidden(scan)).toBe(true);
    expect(extension.records.filter(record => record.kind === 'original')).toHaveLength(1);
    expect(extension.records.filter(record => record.kind === 'pages')).toHaveLength(1);
    expect(extension.unexpected).toEqual([]);
    await page.keyboard.press('Escape'); expect(await driver.hidden(panel)).toBe(true);
  });
}

test('installed hover preserves display on worker 403 and accepts a local file without assigning it to the artwork', async ({ extension }) => {
  extension.replies.set(0, { status: 403 });
  const { page, driver } = await extension.openListing();
  await page.locator('#a').hover(); await expect.poll(() => driver.disabled(scan)).toBe(false);
  await driver.click(scan); await expect.poll(() => driver.text(output)).toContain('http-403');
  expect(await driver.attribute('#metatan-preview img', 'src')).toBe(previewUrl());
  const chooser = page.waitForEvent('filechooser'); await driver.click('.hover-local');
  await (await chooser).setFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png()) });
  await expect.poll(() => driver.text(output)).toContain('手元のファイル: synthetic.png');
  expect(await driver.text(output)).toContain('表示中の作品と同じ画像かは確かめていません');
  expect(extension.records.filter(record => record.kind === 'original')).toHaveLength(1);
});

test('installed hover cancels a stale page during SPA navigation and rejects generic page message attempts', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 900 });
  const { page, driver } = await extension.openListing();
  await page.locator('#a').hover(); await expect.poll(() => driver.disabled(scan)).toBe(false);
  await driver.click(scan); await expect.poll(() => extension.records.filter(record => record.kind === 'original').length).toBe(1);
  await page.evaluate(() => {
    window.postMessage({ type: 'INSPECT_PIXIV_IMAGE', requestId: 'evil', artworkId: '123', page: 0, url: 'https://evil.example/image.png' }, '*');
    history.pushState({}, '', '/users/789/bookmarks/artworks');
  });
  await expect.poll(() => driver.hidden(panel)).toBe(true); expect(await driver.text(output)).toBe('');
  expect(extension.records.filter(record => record.kind === 'original')).toHaveLength(1);
  expect(extension.unexpected).toEqual([]);
});

test('two listing tabs retain the global single-original slot and allow cancellation', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 1200 });
  const first = await extension.openListing(), second = await extension.openListing('/ranking.php');
  await first.page.bringToFront(); await first.page.locator('#a').hover(); await expect.poll(() => first.driver.disabled(scan)).toBe(false);
  await first.driver.click(scan); await expect.poll(() => extension.records.filter(record => record.kind === 'original').length).toBe(1);
  await second.page.bringToFront(); await second.page.locator('#a').hover(); await expect.poll(() => second.driver.disabled(scan)).toBe(false);
  await second.driver.click(scan); await expect.poll(() => second.driver.text(output)).toContain('別の画像を検査中');
  await first.page.bringToFront(); await first.driver.click('.hover-next');
  await expect.poll(() => first.driver.disabled(scan)).toBe(false);
  await first.driver.click(scan); await expect.poll(() => first.driver.text(output)).toContain('作品 123 の 2枚目');
  expect(extension.records.filter(record => record.kind === 'original').map(record => record.page)).toEqual([0, 1]);
});
