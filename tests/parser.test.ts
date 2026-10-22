import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { classifyTextChunks, imageFormat, inspectImage } from '../src/metadata/inspect';
import { parseMetadataJson, parseParameters } from '../src/metadata/normalize';
import { crc32, parsePngTextChunks } from '../src/metadata/png';
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from '../src/limits';
import { chunk, concat, enc, header, idat, png, pngSignature, pngWithText, text } from './fixtures';

describe('PNG text reader with independent synthetic PNGs', () => {
  it('checks the standard CRC vector', () => expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926));
  it.each([['tEXt', false], ['zTXt', true], ['iTXt', false], ['iTXt', true]] as const)('reads %s compressed=%s', async (kind, compressed) => {
    const result = await inspectImage(png(text('Software', 'NovelAI', kind, compressed), text('Comment', '{"seed":123,"uc":"bad"}', kind, compressed)));
    expect(result.status).toBe('found'); expect(result.generator).toBe('novelai');
    expect(result.fields).toMatchObject({ seed: '123', negative: 'bad' });
    expect(result.textEntries[0]?.kind).toBe(kind);
  });
  it.each([false, true])('preserves UTF-8 Japanese and malicious literal text in iTXt (compressed=%s)', async compressed => {
    const value = '猫 🐈\n<script>alert(1)</script>';
    expect((await parsePngTextChunks(png(text('Description', value, 'iTXt', compressed)))).text.Description).toBe(value);
  });
  it('decodes actual Latin-1 rather than Windows-1252', async () => expect((await parsePngTextChunks(png(text('key', '\u0080ÿ', 'zTXt')))).text.key).toBe('\u0080ÿ'));
  it('preserves duplicate keys but excludes them from recognition', async () => {
    const result = await inspectImage(png(text('Software', 'NovelAI'), text('Software', 'Other'), text('Software', 'NovelAI')));
    expect(result.generator).toBe('unknown'); expect(result.textEntries).toHaveLength(3); expect(result.notes.join(' ')).toContain('重複キー');
  });
  it('keeps duplicate signature claims unverified rather than reporting them absent', async () => {
    const result = await inspectImage(png(text('Comment', '{"signed_hash":"fake"}'), text('Comment', '{}')));
    expect(result.novelaiSignature).toBe('not-checked');
  });
  it('preserves prototype-like keys without polluting objects', async () => {
    const result = await parsePngTextChunks(png(text('__proto__', 'value'), text('constructor', 'value')));
    expect(Object.getPrototypeOf(result.text)).toBeNull(); expect(result.text.__proto__).toBe('value'); expect({}).not.toHaveProperty('polluted');
  });
  it('does not infer a generator for unrelated or absent text', async () => {
    expect((await inspectImage(png())).status).toBe('no-metadata');
    expect((await inspectImage(png(text('Description', 'hello')))).generator).toBe('unknown');
  });
  it('accepts text after IDAT', async () => expect((await inspectImage(concat(pngSignature, header(), idat(), text('Software', 'NovelAI'), chunk('IEND')))).generator).toBe('novelai'));
  it.each(['IHDR', 'tEXt', 'IDAT', 'IEND'])('rejects corrupted %s CRC', async tag => {
    const bytes = png(text('Software', 'NovelAI'));
    let offset = 8;
    while (offset < bytes.length) {
      const size = new DataView(bytes.buffer).getUint32(offset);
      if (new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8)) === tag) { bytes[offset + 8 + size] = bytes[offset + 8 + size]! ^ 1; break; }
      offset += size + 12;
    }
    expect((await inspectImage(bytes)).notes[0]).toContain('crc');
  });
  it('rejects truncated, trailing, missing and reordered chunks', async () => {
    const good = png();
    for (const broken of [good.subarray(0, -2), concat(good, new Uint8Array([0])), concat(pngSignature, chunk('IEND')), concat(pngSignature, header(), chunk('IEND')), concat(pngSignature, header(), idat(), text('x', 'y'), idat(), chunk('IEND')), concat(pngSignature, header(), header(), idat(), chunk('IEND'))]) {
      expect((await inspectImage(broken)).status).toBe('parse-error');
    }
  });
  it('rejects overflowing chunk length and giant dimensions', async () => {
    const bytes = png(); new DataView(bytes.buffer).setUint32(8, 0xffffffff);
    expect((await inspectImage(bytes)).status).toBe('parse-error');
    expect((await inspectImage(concat(pngSignature, header(100_000, 100_000), idat(), chunk('IEND')))).status).toBe('too-large');
  });
  it('rejects unsupported critical chunks and too many chunks', async () => {
    expect((await inspectImage(png(chunk('ABCD')))).status).toBe('parse-error');
    expect((await inspectImage(png(...Array.from({ length: 4096 }, () => chunk('aaAA'))))).status).toBe('too-large');
  });
  it('rejects a decompression bomb and cumulative expanded text overflow', async () => {
    expect((await inspectImage(png(text('bomb', 'a'.repeat(MAX_TEXT_BYTES + 1), 'zTXt')))).status).toBe('too-large');
    expect((await inspectImage(png(text('a', 'a'.repeat(MAX_TEXT_BYTES / 2), 'zTXt'), text('b', 'b'.repeat(MAX_TEXT_BYTES / 2), 'zTXt')))).status).toBe('too-large');
  });
  it('rejects oversized raw image/text and excessive entries', async () => {
    expect((await inspectImage(new Uint8Array(MAX_IMAGE_BYTES + 1))).status).toBe('too-large');
    expect((await inspectImage(png(text('x', 'x'.repeat(MAX_TEXT_BYTES))))).status).toBe('too-large');
    expect((await inspectImage(png(...Array.from({ length: 129 }, (_, n) => text(`key${n}`, 'v'))))).status).toBe('too-large');
  });
  it('rejects malformed text headers, keywords, UTF8 and zlib streams', async () => {
    const malformed = [
      chunk('tEXt', enc.encode('no-null')), text(' bad', 'x'), text('x'.repeat(80), 'x'), text('x', 'y\0z'),
      chunk('zTXt', new Uint8Array([65, 0, 1, 0])), chunk('zTXt', new Uint8Array([65, 0, 0, 0])),
      chunk('iTXt', new Uint8Array([65, 0, 2, 0, 0, 0, 65])), chunk('iTXt', new Uint8Array([65, 0, 0, 1, 0, 0, 65])),
      chunk('iTXt', new Uint8Array([65, 0, 0, 0, 65])), chunk('iTXt', new Uint8Array([65, 0, 0, 0, 0, 0, 255])),
      chunk('zTXt', concat(new Uint8Array([65, 0, 0]), deflateSync(enc.encode('x')).subarray(0, -1))),
    ];
    for (const entry of malformed) expect((await inspectImage(png(entry))).status).toBe('parse-error');
  });
  it('honors cancellation', async () => {
    const abort = new AbortController(); abort.abort(); expect((await inspectImage(png(), abort.signal)).status).toBe('cancelled');
  });
  it('does not confuse RIFF/WAVE with WebP and clearly reports unsupported formats', async () => {
    expect(imageFormat(enc.encode('RIFFxxxxWAVE'))).toBe('other');
    expect((await inspectImage(enc.encode('RIFFxxxxWEBP'))).format).toBe('webp');
    expect((await inspectImage(new Uint8Array([255, 216, 255, 224]))).status).toBe('unsupported-format');
  });
});

describe('evidence and normalization', () => {
  it.each([undefined, 'fake-signature', '', null, { verified: true }])('never verifies claimed signatures: %j', signed_hash => {
    const details = signed_hash === undefined ? {} : { signed_hash };
    const result = classifyTextChunks({ Software: 'NovelAI', Description: 'prompt', Source: 'self-reported model', Comment: JSON.stringify(details) });
    expect(result.signature).toBe(signed_hash === undefined ? 'not-present' : 'not-checked');
    expect(result.fields.model).toBe('self-reported model');
  });
  it('does not infer NovelAI from generic parameters or a signature alone', () => {
    expect(classifyTextChunks({ Description: 'x', Comment: '{"sampler":"x","steps":20,"signed_hash":"fake"}' }).generator).toBe('unknown');
    expect(classifyTextChunks({ signed_hash: 'fake' }).signature).toBe('not-checked');
    expect(classifyTextChunks({ Software: 'NovelAI', Comment: '{"signed_hash":broken' }).signature).toBe('not-checked');
  });
  it('keeps mixed NovelAI and ComfyUI evidence and complete graphs', () => {
    const prompt = '{"1":{"class_type":"NovelAINode","inputs":{"arbitrary":["2",0]}}}';
    const workflow = '{"nodes":[{"id":1,"widgets_values":["<img src=x onerror=alert(1)>"]}]}';
    const result = classifyTextChunks({ Software: 'NovelAI', prompt, workflow, Comment: '{"seed":42}' });
    expect(result.detected).toEqual(['novelai', 'comfyui']);
    expect(result.fields['ComfyUI API prompt JSON']).toBe(prompt);
    expect(result.fields['ComfyUI workflow JSON']).toBe(workflow);
  });
  it('supports workflow-only without claiming an engine or unique positive prompt', () => {
    const result = classifyTextChunks({ workflow: '{"nodes":[]}' });
    expect(result.generator).toBe('comfyui'); expect(result.fields.prompt).toBeUndefined();
  });
  it('rejects invalid or unrelated JSON as detection evidence', () => {
    for (const workflow of ['broken', 'null', '[]', '"string"', '{"nodes":[null]}', '{}']) expect(classifyTextChunks({ workflow }).generator).toBe('unknown');
    expect(classifyTextChunks({ prompt: '{"class_type":"example"}' }).generator).toBe('unknown');
  });
  it('bounds JSON nesting and node count', () => {
    expect(() => parseMetadataJson('['.repeat(65) + '0' + ']'.repeat(65))).toThrow('deep');
    expect(() => parseMetadataJson(JSON.stringify(Array.from({ length: 50_001 }, () => 1)))).toThrow('values');
    expect(parseMetadataJson('{"x":"[[[\\\"}"}')).toEqual({ x: '[[["}' });
  });
  it('splits A1111/Forge multiline prompts and settings with quoted commas', () => {
    const result = classifyTextChunks({ parameters: 'line 1\r\nline 2\r\nNegative prompt: low quality\r\nmore negative\r\nSteps: 20, Sampler: DPM++ 2M, CFG scale: 7, Seed: 123, Size: 512x768, Model: "model, name", VAE: vae\r\n' });
    expect(result.generator).toBe('a1111-forge');
    expect(result.fields).toMatchObject({ prompt: 'line 1\nline 2', negative: 'low quality\nmore negative', steps: '20', sampler: 'DPM++ 2M', cfg: '7', seed: '123', size: '512x768', model: 'model, name', vae: 'vae' });
  });
  it('does not split arbitrary prose or infer omitted A1111 values', () => {
    expect(parseParameters('a sentence with Steps: 20, Sampler: X')).toEqual({});
    expect(parseParameters('p\nSteps: 5')).toEqual({ prompt: 'p', steps: '5' });
  });
});
