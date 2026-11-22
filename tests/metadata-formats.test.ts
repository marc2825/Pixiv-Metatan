import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { inspectImage } from '../src/metadata/inspect';
import { classifyTextChunks, v4Captions } from '../src/metadata/normalize';
import { parsePngTextChunks } from '../src/metadata/png';
import { readStealth } from '../src/metadata/stealth';
import { jpegExif, parseExifText, webpExif } from '../src/metadata/exif';
import { MAX_STEALTH_BYTES, MAX_STEALTH_ROW_BYTES } from '../src/limits';
import { asciiValue, chunk, concat, enc, idat, ihdr, jpeg, pngSignature, stealthPng, stealthStream, text, tiff, userComment, webp } from './fixtures';

const novelai = { Software: 'NovelAI', Description: 'stealth prompt', Comment: JSON.stringify({ prompt: 'stealth prompt', uc: 'stealth negative', seed: 7, signed_hash: 'claimed' }) };
const stealthOf = async (bytes: Uint8Array) => readStealth(await parsePngTextChunks(bytes));

describe('NovelAI stealth_pngcomp (alpha LSB) reader', () => {
  it.each([[[0]], [[1]], [[2]], [[3]], [[4]], [[0, 1, 2, 3, 4]]])('reverses PNG filter types %j and reads column-major bits', async filters => {
    const result = await stealthOf(stealthPng(40, 130, stealthStream(novelai), { filters }));
    expect(result.state).toBe('found'); expect(result.data?.Software).toBe('NovelAI');
  });
  it('reads magic spread over several columns when the image is shorter than 120 px', async () => {
    const result = await stealthOf(stealthPng(200, 9, stealthStream(novelai)));
    expect(result).toMatchObject({ state: 'found', data: { Description: 'stealth prompt' } });
  });
  it('supports 8-bit grey+alpha like the official RGBA conversion', async () => {
    expect((await stealthOf(stealthPng(64, 64, stealthStream(novelai), { color: 4 }))).state).toBe('found');
  });
  it('classifies stealth-only data, keeps signature claims unverified and labels the evidence source', async () => {
    const result = await inspectImage(stealthPng(64, 64, stealthStream(novelai)));
    expect(result).toMatchObject({ status: 'found', stealth: 'found', generator: 'novelai', confidence: 'metadata-indicates', novelaiSignature: 'not-checked' });
    expect(result.fields).toMatchObject({ prompt: 'stealth prompt', negative: 'stealth negative', seed: '7' });
    expect(result.evidence.map(item => item.source)).toContain('stealth_pngcomp');
    expect(result.textEntries.every(entry => entry.kind === 'stealth')).toBe(true);
  });
  it('reports text/stealth disagreements instead of silently overriding the text chunk', async () => {
    const bytes = stealthPng(64, 64, stealthStream(novelai), { extra: [text('Software', 'NovelAI'), text('Comment', JSON.stringify({ prompt: 'text prompt', seed: 7 }))] });
    const result = await inspectImage(bytes);
    expect(result.fields.prompt).toBe('text prompt'); expect(result.fields.negative).toBe('stealth negative');
    expect(result.notes.join(' ')).toContain('通常テキストとStealthで値が異なります（prompt）');
  });
  it('stops after the magic rows for non-stealth images (later corrupt rows are never decoded)', async () => {
    const plain = stealthPng(16, 200, new Uint8Array(0), { corruptAfterRow: 125 });
    expect(await stealthOf(plain)).toEqual({ state: 'not-present', reason: 'stealth-magic-absent' });
    const corruptEarly = stealthPng(16, 200, new Uint8Array(0), { corruptAfterRow: 10 });
    expect((await stealthOf(corruptEarly)).state).toBe('not-checked');
  });
  it('treats RGB without tRNS as not carrying stealth data and skips unsupported layouts', async () => {
    expect(await stealthOf(concat(pngSignature, ihdr(4, 4, 8, 2), idat(), chunk('IEND')))).toEqual({ state: 'not-present', reason: 'stealth-no-alpha' });
    const layout = { width: 64, height: 64, transparency: false, idat: [] as Uint8Array[] };
    expect(await readStealth({ ...layout, bitDepth: 16, colorType: 6, interlace: 0 })).toMatchObject({ state: 'not-checked', reason: 'stealth-unsupported-layout' });
    expect(await readStealth({ ...layout, bitDepth: 8, colorType: 6, interlace: 1 })).toMatchObject({ state: 'not-checked', reason: 'stealth-unsupported-layout' });
    expect(await readStealth({ ...layout, bitDepth: 8, colorType: 3, interlace: 0, transparency: true })).toMatchObject({ state: 'not-checked', reason: 'stealth-unsupported-layout' });
    expect(await readStealth({ ...layout, width: 4, height: 4, bitDepth: 8, colorType: 6, interlace: 0 })).toMatchObject({ state: 'not-present', reason: 'stealth-too-small' });
  });
  it('never allocates huge row buffers for extreme aspect ratios (issue #10)', async () => {
    // 40,000,000 x 1 RGBA passes MAX_PIXELS but would need ~160 MB per row buffer.
    const extreme = concat(pngSignature, ihdr(40_000_000, 1), text('Software', 'NovelAI'), text('Comment', '{"seed":1}'), idat(), chunk('IEND'));
    const started = performance.now();
    expect(await stealthOf(extreme)).toEqual({ state: 'not-checked', reason: 'stealth-row-too-large' });
    const result = await inspectImage(extreme);
    expect(result).toMatchObject({ status: 'found', generator: 'novelai', stealth: 'not-checked', fields: { seed: '1' } });
    expect(result.notes.join(' ')).toContain('Stealth（アルファチャンネル）は未検査');
    expect(performance.now() - started).toBeLessThan(1000);
    // Boundary: a row of exactly 1 MiB is still decoded (here the empty IDAT then fails as image data).
    const layout = { height: 1, bitDepth: 8, colorType: 6, interlace: 0, transparency: false, idat: [] as Uint8Array[] };
    const boundary = await readStealth({ ...layout, width: MAX_STEALTH_ROW_BYTES / 4 });
    expect(boundary.state).toBe('not-checked'); expect(boundary.reason).not.toBe('stealth-row-too-large');
    expect(await readStealth({ ...layout, width: MAX_STEALTH_ROW_BYTES / 4 + 1 })).toEqual({ state: 'not-checked', reason: 'stealth-row-too-large' });
    expect(await readStealth({ ...layout, colorType: 4, width: MAX_STEALTH_ROW_BYTES / 2 + 1 })).toEqual({ state: 'not-checked', reason: 'stealth-row-too-large' });
  });
  it('identifies the uncompressed third-party variant without guessing its content', async () => {
    expect(await stealthOf(stealthPng(64, 64, stealthStream(novelai, 'stealth_pnginfo')))).toEqual({ state: 'not-checked', reason: 'stealth-uncompressed-unsupported' });
  });
  it.each([
    ['length beyond image', stealthStream(novelai, 'stealth_pngcomp', 8 * 100_000), 'stealth-truncated'],
    ['zero length', stealthStream(novelai, 'stealth_pngcomp', 0), 'stealth-truncated'],
    ['over the compressed cap', stealthStream(novelai, 'stealth_pngcomp', 8 * (MAX_STEALTH_BYTES + 1)), 'stealth-too-large'],
    ['invalid gzip', stealthStream(null, 'stealth_pngcomp', undefined, enc.encode('not gzip at all')), 'stealth-invalid-gzip'],
  ])('rejects %s safely', async (_name, stream, reason) => {
    expect(await stealthOf(stealthPng(64, 64, stream as Uint8Array))).toEqual({ state: 'not-checked', reason });
  });
  it('bounds a gzip bomb inside the stealth payload', async () => {
    const bomb = gzipSync(new Uint8Array(3 * 1024 * 1024));
    expect(await stealthOf(stealthPng(400, 400, stealthStream(null, 'stealth_pngcomp', undefined, bomb)))).toEqual({ state: 'not-checked', reason: 'stealth-text-too-large' });
  });
  it('keeps non-JSON stealth text for RAW review without claiming a generator', async () => {
    const result = await inspectImage(stealthPng(64, 64, stealthStream(null, 'stealth_pngcomp', undefined, gzipSync(enc.encode('<b>plain</b> text')))));
    expect(result).toMatchObject({ status: 'found', stealth: 'found', generator: 'unknown' });
    expect(result.textEntries).toContainEqual({ keyword: 'stealth text', value: '<b>plain</b> text', kind: 'stealth' });
  });
  it('preserves prototype-like stealth keys without pollution', async () => {
    const result = await stealthOf(stealthPng(64, 64, stealthStream(JSON.parse('{"__proto__":{"polluted":1},"constructor":"x"}'))));
    expect(Object.getPrototypeOf(result.data)).toBeNull(); expect(result.data?.__proto__).toBe('{"polluted":1}'); expect({}).not.toHaveProperty('polluted');
  });
  it('honors cancellation while decoding image rows', async () => {
    const abort = new AbortController(); abort.abort();
    const bytes = stealthPng(64, 200, stealthStream(novelai));
    await expect(readStealth(await parsePngTextChunks(bytes), abort.signal)).rejects.toThrow();
    expect((await inspectImage(bytes, abort.signal)).status).toBe('cancelled');
  });
});

describe('EXIF text for JPEG/WebP', () => {
  const parameters = 'cat\nNegative prompt: dog\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1';
  it.each([['MM', false], ['II', true]] as const)('decodes a %s UNICODE UserComment as AUTOMATIC1111/Forge parameters', async (order, le) => {
    const result = await inspectImage(jpeg(tiff(order, [], [{ tag: 0x9286, type: 7, value: userComment(parameters, 'UNICODE', le) }])));
    expect(result).toMatchObject({ status: 'found', format: 'jpeg', generator: 'a1111-forge', stealth: 'not-checked' });
    expect(result.fields).toMatchObject({ prompt: 'cat', negative: 'dog', steps: '20', seed: '1' });
  });
  it.each(['ASCII', 'UNDEFINED'] as const)('decodes %s UserComment code', code => {
    expect(parseExifText(tiff('MM', [], [{ tag: 0x9286, type: 7, value: userComment(parameters, code) }])).classify.parameters).toBe(parameters);
  });
  it('maps ComfyUI WebP prompt/workflow tags only from the documented IFD0 text tags', async () => {
    const graph = '{"1":{"class_type":"KSampler","inputs":{}}}', flow = '{"nodes":[]}';
    const exif = tiff('II', [{ tag: 0x0110, type: 2, value: asciiValue(`prompt:${graph}`) }, { tag: 0x010f, type: 2, value: asciiValue(`workflow:${flow}`) }, { tag: 0x013b, type: 2, value: asciiValue('prompt:{"x":1}') }]);
    for (const bytes of [webp(exif), webp(exif, true)]) {
      const result = await inspectImage(bytes);
      expect(result).toMatchObject({ format: 'webp', generator: 'comfyui' });
      expect(result.fields['ComfyUI API prompt JSON']).toBe(graph);
    }
    expect(parseExifText(exif).classify.prompt).toBe(graph);
  });
  it('reports JPEG/WebP without EXIF as no metadata rather than unsupported', async () => {
    expect((await inspectImage(jpeg())).status).toBe('no-metadata');
    expect((await inspectImage(webp())).status).toBe('no-metadata');
    expect((await inspectImage(webp())).notes.join(' ')).toContain('人間が描いた証拠になりません');
  });
  it.each([
    ['truncated JPEG segment', concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), new Uint8Array(4))],
    ['bad JPEG marker', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0x12, 0x34, 0x00, 0x00])],
    ['JPEG ending before SOS', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])],
    ['WebP chunk past RIFF', concat(enc.encode('RIFF'), new Uint8Array([20, 0, 0, 0]), enc.encode('WEBPEXIF'), new Uint8Array([200, 0, 0, 0]), new Uint8Array(8))],
    ['WebP RIFF past file', concat(enc.encode('RIFF'), new Uint8Array([255, 255, 0, 0]), enc.encode('WEBP'))],
  ])('rejects %s', async (_name, bytes) => {
    expect((await inspectImage(bytes)).status).toBe('parse-error');
  });
  it('bounds TIFF offsets, IFD counts and byte order', () => {
    const good = tiff('MM', [{ tag: 0x0131, type: 2, value: asciiValue('a long software name') }]);
    const badOffset = good.slice(); new DataView(badOffset.buffer).setUint32(8 + 2 + 8, 60_000);
    expect(() => parseExifText(badOffset)).toThrow('malformed-exif-offset');
    const badCount = good.slice(); new DataView(badCount.buffer).setUint16(8, 600);
    expect(() => parseExifText(badCount)).toThrow('malformed-exif-ifd');
    const badOrder = good.slice(); badOrder[0] = 0x58;
    expect(() => parseExifText(badOrder)).toThrow('byte-order');
    expect(() => parseExifText(new Uint8Array(4))).toThrow('invalid-exif');
    const loop = tiff('MM', [], [{ tag: 0x8769, type: 4, value: new Uint8Array(4) }]);
    expect(() => parseExifText(loop)).not.toThrow();
  });
  it('locates EXIF only before SOS and in the first EXIF chunk', () => {
    expect(jpegExif(jpeg())).toBeUndefined();
    expect(webpExif(webp())).toBeUndefined();
    expect(() => jpegExif(new Uint8Array([0, 1]))).toThrow('not-jpeg');
  });
  it('renders executable-looking EXIF only as data', async () => {
    const attack = '<img src=x onerror=alert(1)>';
    const result = await inspectImage(jpeg(tiff('MM', [{ tag: 0x010e, type: 2, value: asciiValue(attack) }])));
    expect(result.textEntries).toContainEqual({ keyword: 'Exif.ImageDescription', value: attack, kind: 'exif' });
    expect(result.generator).toBe('unknown');
  });
});

describe('NovelAI V4/V4.5 character captions (official API schema)', () => {
  const comment = (extra: object) => JSON.stringify({ prompt: 'base', uc: 'base negative', ...extra });
  it('extracts per-character prompts, negatives and positions without dropping order', () => {
    const v4_prompt = { caption: { base_caption: 'base', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.1, y: 0.9 }] }, { char_caption: 'boy', centers: [] }] } };
    const v4_negative_prompt = { caption: { base_caption: 'base negative', char_captions: [{ char_caption: '', centers: [] }, { char_caption: 'blurry', centers: [] }] } };
    const result = classifyTextChunks({ Software: 'NovelAI', Comment: comment({ v4_prompt, v4_negative_prompt }) });
    expect(result.fields).toMatchObject({ 'character 1 prompt': 'girl', 'character 1 position': '(0.1, 0.9)', 'character 2 prompt': 'boy', 'character 2 negative': 'blurry' });
    expect(result.fields['character 1 negative']).toBeUndefined();
    expect(result.fields['base prompt']).toBeUndefined();
  });
  it('shows a base caption only when it differs from the top-level prompt', () => {
    const result = classifyTextChunks({ Software: 'NovelAI', Comment: comment({ v4_prompt: { caption: { base_caption: 'different', char_captions: [] } } }) });
    expect(result.fields['base prompt']).toBe('different');
  });
  it.each([{ caption: 'x' }, { caption: { base_caption: 1 } }, { caption: { char_captions: [{ char_caption: 2 }] } }, { caption: { char_captions: 'x' } }, null])('flags schema mismatches %j instead of guessing', v4_prompt => {
    const result = classifyTextChunks({ Software: 'NovelAI', Comment: comment({ v4_prompt }) });
    expect(result.fields['character 1 prompt']).toBeUndefined();
    expect(result.notes.join(' ')).toContain('公式APIスキーマと一致しません');
  });
  it('bounds character count and treats negative_prompt only as a fallback for uc', () => {
    const char_captions = Array.from({ length: 40 }, (_, i) => ({ char_caption: `c${i}`, centers: [] }));
    expect(v4Captions({ caption: { char_captions } })?.characters).toHaveLength(32);
    expect(classifyTextChunks({ Software: 'NovelAI', Comment: JSON.stringify({ negative_prompt: 'np' }) }).fields.negative).toBe('np');
    expect(classifyTextChunks({ Software: 'NovelAI', Comment: JSON.stringify({ uc: 'uc', negative_prompt: 'np' }) }).fields.negative).toBe('uc');
  });
  it('does not read V4 captions without a NovelAI self-report', () => {
    expect(classifyTextChunks({ Comment: comment({ v4_prompt: { caption: { char_captions: [{ char_caption: 'x' }] } } }) }).fields['character 1 prompt']).toBeUndefined();
  });
});
