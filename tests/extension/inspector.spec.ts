import { test, expect, png, pngWithText } from './fixtures';
import { ui } from './driver';
import { fieldLabel } from '../../src/ui/result';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import reference from '../reference/fixtures/expected.json' with { type: 'json' };

async function ready(driver: import('./driver').InspectorDriver) {
  await driver.click(ui.toggle);
  await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
}
/** A shown result is reused for two minutes, so each case uses another artwork (SPA navigation). */
async function fresh(page: import('@playwright/test').Page, driver: import('./driver').InspectorDriver, id: string) {
  await page.evaluate(path => history.pushState({}, '', path), `/artworks/${id}`);
  await expect.poll(() => driver.hidden(ui.panel)).toBe(true);
  await ready(driver);
}
const titleFor = (row: { status: string; generator: string }) => row.status === 'no-metadata' ? '生成情報は見つかりませんでした'
  : row.status === 'unsupported-format' ? '読めない形式です'
  : ({ novelai: 'NovelAIで生成したと書かれています', comfyui: 'ComfyUIの生成情報が入っています', 'a1111-forge': 'AUTOMATIC1111 / Forgeの生成情報が入っています' } as Record<string, string>)[row.generator] ?? '生成ツールは書かれていません';

test('production injection, closed root and real runtime messaging inspect exactly one chosen image', async ({ extension }) => {
  const { page, driver } = await extension.open();
  expect(await page.evaluate(() => document.getElementById('metatan-root')?.shadowRoot)).toBeNull();
  expect(extension.records.map(r => r.kind)).toEqual(['document']);
  await ready(driver); expect(await driver.text(ui.counter)).toBe('1 / 2');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(0);
  await driver.click(ui.next); await driver.click(ui.scan);
  await expect.poll(() => driver.summary()).toBe('NovelAIで生成したと書かれています');
  expect(await driver.text(ui.result)).toContain('NovelAI電子署名: 未検証');
  expect(await driver.text(ui.result)).toContain('作品 123 の 2枚目');
  expect(extension.records.filter(r => r.kind === 'original')).toMatchObject([{ kind: 'original', worker: true, page: 1, status: 200, mime: 'image/png', cookie: false }]);
  expect(extension.unexpected).toEqual([]);
});

test('workflow, A1111, no metadata, JPEG EXIF and truncated JPEG remain distinguishable through the installed extension', async ({ extension }) => {
  const { page, driver } = await extension.open();
  const cases = [
    { body: pngWithText({ workflow: '{"nodes":[]}' }), mime: 'image/png', expected: 'ComfyUIの生成情報が入っています', format: 'PNG' },
    { body: pngWithText({ parameters: 'synthetic\nNegative prompt: bad\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42' }), mime: 'image/png', expected: 'AUTOMATIC1111 / Forgeの生成情報が入っています', format: 'PNG' },
    { body: png(), mime: 'image/png', expected: '生成情報は見つかりませんでした', format: 'PNG' },
    { body: new Uint8Array(readFileSync('tests/reference/fixtures/a1111-exif.jpg')), mime: 'image/jpeg', expected: 'AUTOMATIC1111 / Forgeの生成情報が入っています', format: 'JPEG' },
    { body: new Uint8Array(readFileSync('tests/reference/fixtures/synthetic.jpg')), mime: 'image/jpeg', expected: '生成情報は見つかりませんでした', format: 'JPEG' },
    { body: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg', expected: 'データが壊れているため、読めませんでした', format: 'JPEG' },
  ];
  for (const [index, item] of cases.entries()) {
    await fresh(page, driver, String(1000 + index));
    extension.replies.set(0, item); await driver.click(ui.scan);
    await expect.poll(() => driver.summary()).toBe(item.expected);
    expect(await driver.text(ui.result)).toContain(`形式: ${item.format}`);
  }
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(6);
});

test('real 403 response path offers explicit local fallback with no retry', async ({ extension }) => {
  extension.replies.set(0, { status: 403 });
  const { driver } = await extension.open(); await ready(driver);
  expect(await driver.hidden(ui.file)).toBe(true);
  await driver.click(ui.scan);
  await expect.poll(() => driver.summary()).toBe('原寸画像を読み込めませんでした');
  expect(await driver.text(ui.result)).toContain('http-403');
  await expect.poll(() => driver.disabled(ui.file)).toBe(false);
  await driver.files({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(pngWithText({ Software: 'NovelAI' })) });
  await expect.poll(() => driver.text(ui.result)).toContain('手元のファイル: synthetic.png');
  expect(await driver.text(ui.result)).toContain('表示中の作品と同じ画像かは確かめていません');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
});

test('independent official-reader/writer fixtures pass the actual worker and content script', async ({ extension }) => {
  const { page, driver } = await extension.open();
  for (const [index, row] of reference.rows.entries()) {
    await fresh(page, driver, String(2000 + index));
    extension.replies.set(0, {
      body: new Uint8Array(readFileSync(new URL(`../reference/fixtures/${row.file}`, import.meta.url))),
      mime: `image/${row.format}`,
    });
    await driver.click(ui.scan);
    await expect.poll(() => driver.summary()).toBe(titleFor(row));
    expect(await driver.text(ui.result)).toContain(`形式: ${row.format.toUpperCase()}`);
    // ComfyUI graphs are collapsed (rendered lazily); check their disclosure label instead of content.
    if ('fields' in row) for (const [key, value] of Object.entries(row.fields!)) expect(await driver.text(ui.result)).toContain(key.startsWith('ComfyUI') ? fieldLabel(key) : value);
    if ('stealth' in row && row.stealth === 'found') expect(await driver.text(ui.result)).toContain('stealth_pngcompデータあり');
    expect(await driver.text(ui.result)).not.toContain('NovelAI電子署名: 検証成功');
  }
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(reference.rows.length);
});

test('denied artwork API keeps local original selection available without requesting an image', async ({ extension }) => {
  extension.apiStatus = 429;
  const { driver } = await extension.open(); await driver.click(ui.toggle);
  await expect.poll(() => driver.text(ui.status)).toContain('pixiv-pages-http-429');
  expect(await driver.disabled(ui.scan)).toBe(true); expect(await driver.disabled(ui.file)).toBe(false);
  await driver.localFile(resolve('tests/reference/fixtures/no-metadata.png'));
  await expect.poll(() => driver.summary()).toBe('生成情報は見つかりませんでした');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(0);
});

test('two tabs share one worker fetch slot; switching pages cancels the owner request', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 1200 });
  const first = await extension.open(), second = await extension.open();
  await ready(first.driver); await ready(second.driver);
  await first.driver.click(ui.scan);
  await expect.poll(() => extension.records.filter(r => r.kind === 'original').length).toBe(1);
  await second.page.bringToFront(); await second.driver.click(ui.scan);
  await expect.poll(() => second.driver.text(ui.result)).toContain('別の画像を検査中');
  expect(await second.driver.summary()).toBe('別の画像を読み込んでいます');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
  await first.page.bringToFront(); await first.driver.click(ui.next);
  await expect.poll(() => first.driver.disabled(ui.scan)).toBe(false);
  expect(await first.driver.text(ui.result)).toContain('まだ読み込んでいません');
  await first.driver.click(ui.scan);
  await expect.poll(() => first.driver.text(ui.result)).toContain('作品 123 の 2枚目');
  expect(extension.records.filter(r => r.kind === 'original').map(r => r.page)).toEqual([0, 1]);
});

test('SPA discards old work and preserves sender validation across artwork IDs', async ({ extension }) => {
  const { page, driver } = await extension.open();
  await page.evaluate(() => history.pushState({}, '', '/users/123'));
  await expect.poll(() => driver.hidden(ui.toggle)).toBe(true);
  await page.evaluate(() => history.pushState({}, '', '/artworks/456'));
  await expect.poll(() => driver.hidden(ui.toggle)).toBe(false);
  await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('作品 456 の 1枚目');
  await page.evaluate(() => history.pushState({}, '', '/artworks/789'));
  await expect.poll(() => driver.hidden(ui.panel)).toBe(true);
  expect(await driver.text(ui.result)).toBe('');
  expect(extension.records.filter(r => r.kind === 'pages')).toHaveLength(1);
});

test('worker network interruption is acquisition failure, and a later explicit click recovers', async ({ extension }) => {
  extension.replies.set(0, { failure: true });
  const { driver } = await extension.open(); await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.summary()).toBe('原寸画像を読み込めませんでした');
  await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
  extension.replies.set(0, { body: png() }); await driver.click(ui.scan);
  await expect.poll(() => driver.summary()).toBe('生成情報は見つかりませんでした');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(2);
});

test('15-second production timeout ends the operation and enables local fallback', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 17_000 });
  const { driver } = await extension.open(); await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result), { timeout: 18_000 }).toContain('タイムアウト');
  expect(await driver.disabled(ui.file)).toBe(false);
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
});

test('toolbar inspector page reads local files inside the installed extension without any network request (#15)', async ({ extension }) => {
  const id = new URL(extension.worker.url()).host;
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${id}/inspector.html`);
  await expect(page.getByRole('heading', { name: '手元の画像を調べる' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを選ぶ', exact: true }).click();
  // Written by NovelAI's official stealth writer (alpha channel only), see tests/reference/README.md.
  await (await chooser).setFiles([resolve('tests/reference/fixtures/novelai-stealth-only.png'), resolve('tests/reference/fixtures/a1111-exif.jpg')]);
  const result = page.getByLabel('ローカル検査結果', { exact: true });
  await expect(result).toContainText('NovelAIで生成したと書かれています');
  await expect(result).toContainText('stealth_pngcompデータあり');
  await expect(result).toContainText('手元のファイル: novelai-stealth-only.png');
  // The chosen file is shown from an object URL in this extension page, never fetched.
  await expect(page.locator('.local-preview')).toHaveAttribute('src', /^blob:chrome-extension:/);
  const list = page.getByRole('list', { name: '調べた画像' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('button').nth(1)).toContainText('AUTOMATIC1111 / Forgeの生成情報が入っています');
  await list.getByRole('button').nth(1).click();
  await expect(result).toContainText('手元のファイル: a1111-exif.jpg');
  await page.screenshot({ path: '.test-browser/local-inspector.png', animations: 'disabled' });
  expect(extension.records.filter(r => r.kind !== 'other')).toEqual([]);
  expect(extension.unexpected).toEqual([]);
});
