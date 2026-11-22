import { test, expect, png, pngWithText } from './fixtures';
import { ui } from './driver';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import reference from '../reference/fixtures/expected.json' with { type: 'json' };

async function ready(driver: import('./driver').InspectorDriver) {
  await driver.click(ui.toggle);
  await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
}

test('production injection, closed root and real runtime messaging inspect exactly one chosen image', async ({ extension }) => {
  const { page, driver } = await extension.open();
  expect(await page.evaluate(() => document.getElementById('metatan-root')?.shadowRoot)).toBeNull();
  expect(extension.records.map(r => r.kind)).toEqual(['document']);
  await ready(driver); expect(await driver.options()).toHaveLength(2);
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(0);
  await driver.select(1); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('メタデータから推定: novelai');
  expect(await driver.text(ui.result)).toContain('NovelAI電子署名: 未検証');
  expect(await driver.text(ui.result)).toContain('作品 123 / 2枚目');
  expect(extension.records.filter(r => r.kind === 'original')).toMatchObject([{ kind: 'original', worker: true, page: 1, status: 200, mime: 'image/png', cookie: false }]);
  expect(extension.unexpected).toEqual([]);
});

test('workflow, A1111, no metadata, JPEG EXIF and truncated JPEG remain distinguishable through the installed extension', async ({ extension }) => {
  const { driver } = await extension.open(); await ready(driver);
  const cases = [
    { body: pngWithText({ workflow: '{"nodes":[]}' }), mime: 'image/png', expected: 'メタデータから推定: comfyui' },
    { body: pngWithText({ parameters: 'synthetic\nNegative prompt: bad\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42' }), mime: 'image/png', expected: 'メタデータから推定: a1111-forge' },
    { body: png(), mime: 'image/png', expected: '対応範囲にメタデータなし / png' },
    { body: new Uint8Array(readFileSync('tests/reference/fixtures/a1111-exif.jpg')), mime: 'image/jpeg', expected: 'テキスト情報あり / jpeg / メタデータから推定: a1111-forge' },
    { body: new Uint8Array(readFileSync('tests/reference/fixtures/synthetic.jpg')), mime: 'image/jpeg', expected: '対応範囲にメタデータなし / jpeg' },
    { body: new Uint8Array([255, 216, 255, 224]), mime: 'image/jpeg', expected: '解析失敗 / jpeg' },
  ];
  for (const item of cases) {
    extension.replies.set(0, item); await driver.click(ui.scan);
    await expect.poll(() => driver.text(ui.result)).toContain(item.expected);
    await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
  }
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(6);
});

test('real 403 response path offers explicit local fallback with no retry', async ({ extension }) => {
  extension.replies.set(0, { status: 403 });
  const { driver } = await extension.open(); await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('http-403');
  expect(await driver.text(ui.result)).toContain('取得不能');
  await expect.poll(() => driver.disabled(ui.file)).toBe(false);
  await driver.files({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(pngWithText({ Software: 'NovelAI' })) });
  await expect.poll(() => driver.text(ui.result)).toContain('ローカル: synthetic.png');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
});

test('independent official-reader/writer fixtures pass the actual worker and content script', async ({ extension }) => {
  const { driver } = await extension.open(); await ready(driver);
  for (const row of reference.rows) {
    extension.replies.set(0, {
      body: new Uint8Array(readFileSync(new URL(`../reference/fixtures/${row.file}`, import.meta.url))),
      mime: `image/${row.format}`,
    });
    await driver.click(ui.scan);
    const marker = row.status === 'no-metadata' ? '対応範囲にメタデータなし' : row.status === 'unsupported-format' ? '未対応形式' : 'テキスト情報あり';
    await expect.poll(() => driver.summary()).toContain(`${marker} / ${row.format}`);
    if (row.generator !== 'unknown') expect(await driver.summary()).toContain(`メタデータから推定: ${row.generator}`);
    // ComfyUI graphs are collapsed (rendered lazily); check their disclosure label instead of content.
    if ('fields' in row) for (const [key, value] of Object.entries(row.fields!)) expect(await driver.text(ui.result)).toContain(key.startsWith('ComfyUI') ? key : value);
    if ('stealth' in row && row.stealth === 'found') expect(await driver.text(ui.result)).toContain('stealth_pngcompデータあり');
    expect(await driver.text(ui.result)).not.toContain('NovelAI電子署名: 検証成功');
    await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
  }
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(reference.rows.length);
});

test('denied artwork API keeps local original selection available without requesting an image', async ({ extension }) => {
  extension.apiStatus = 429;
  const { driver } = await extension.open(); await driver.click(ui.toggle);
  await expect.poll(() => driver.text(ui.status)).toContain('pixiv-pages-http-429');
  expect(await driver.disabled(ui.scan)).toBe(true); expect(await driver.disabled(ui.file)).toBe(false);
  await driver.localFile(resolve('tests/reference/fixtures/no-metadata.png'));
  await expect.poll(() => driver.text(ui.result)).toContain('対応範囲にメタデータなし');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(0);
});

test('two tabs share one worker fetch slot; selecting another page cancels the owner request', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 1200 });
  const first = await extension.open(), second = await extension.open();
  await ready(first.driver); await ready(second.driver);
  await first.driver.click(ui.scan);
  await expect.poll(() => extension.records.filter(r => r.kind === 'original').length).toBe(1);
  await second.page.bringToFront(); await second.driver.click(ui.scan);
  await expect.poll(() => second.driver.text(ui.result)).toContain('別の画像を検査中');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
  await first.page.bringToFront(); await first.driver.select(1);
  await expect.poll(() => first.driver.disabled(ui.scan)).toBe(false);
  expect(await first.driver.text(ui.result)).toBe('');
  await first.driver.click(ui.scan);
  await expect.poll(() => first.driver.text(ui.result)).toContain('作品 123 / 2枚目');
  expect(extension.records.filter(r => r.kind === 'original').map(r => r.page)).toEqual([0, 1]);
});

test('SPA discards old work and preserves sender validation across artwork IDs', async ({ extension }) => {
  const { page, driver } = await extension.open();
  await page.evaluate(() => history.pushState({}, '', '/users/123'));
  await expect.poll(() => driver.options()).toEqual([]);
  await page.evaluate(() => history.pushState({}, '', '/artworks/456'));
  await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('作品 456 / 1枚目');
  await page.evaluate(() => history.pushState({}, '', '/artworks/789'));
  await expect.poll(() => driver.options()).toEqual([]);
  expect(await driver.text(ui.result)).toBe('');
  expect(extension.records.filter(r => r.kind === 'pages')).toHaveLength(1);
});

test('worker network interruption is acquisition failure, and a later explicit Inspect recovers', async ({ extension }) => {
  extension.replies.set(0, { failure: true });
  const { driver } = await extension.open(); await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('取得不能');
  expect(await driver.text(ui.result)).not.toContain('対応範囲にメタデータなし');
  await expect.poll(() => driver.disabled(ui.scan)).toBe(false);
  extension.replies.set(0, { body: png() }); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result)).toContain('対応範囲にメタデータなし');
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(2);
});

test('15-second production timeout ends the operation and enables local fallback', async ({ extension }) => {
  extension.replies.set(0, { delayMs: 17_000 });
  const { driver } = await extension.open(); await ready(driver); await driver.click(ui.scan);
  await expect.poll(() => driver.text(ui.result), { timeout: 18_000 }).toContain('タイムアウト');
  expect(await driver.disabled(ui.file)).toBe(false);
  expect(extension.records.filter(r => r.kind === 'original')).toHaveLength(1);
});

test('toolbar inspector page reads a local file inside the installed extension without any network request (#15)', async ({ extension }) => {
  const id = new URL(extension.worker.url()).host;
  const page = await extension.context.newPage();
  await page.goto(`chrome-extension://${id}/inspector.html`);
  await expect(page.getByRole('heading', { name: 'ローカル画像のメタデータ検査' })).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'ファイルを選択', exact: true }).click();
  // Written by NovelAI's official stealth writer (alpha channel only), see tests/reference/README.md.
  await (await chooser).setFiles(resolve('tests/reference/fixtures/novelai-stealth-only.png'));
  const result = page.getByLabel('ローカル検査結果', { exact: true });
  await expect(result).toContainText('メタデータから推定: novelai');
  await expect(result).toContainText('stealth_pngcompデータあり');
  await expect(result).toContainText('ローカル: novelai-stealth-only.png');
  expect(extension.records.filter(r => r.kind !== 'other')).toEqual([]);
  expect(extension.unexpected).toEqual([]);
});
