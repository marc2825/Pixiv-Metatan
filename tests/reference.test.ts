import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectImage } from '../src/metadata/inspect';
import expected from './reference/fixtures/expected.json' with { type: 'json' };

describe('independent PNG fixtures checked with pinned NovelAI reader and ComfyUI SaveImage', () => {
  it.each(expected.rows)('$file matches independent file metadata and classification', async row => {
    const bytes = new Uint8Array(readFileSync(new URL(`./reference/fixtures/${row.file}`, import.meta.url)));
    const result = await inspectImage(bytes);
    expect(result.status).toBe(row.status); expect(result.format).toBe(row.format); expect(result.generator).toBe(row.generator);
    if ('chunks' in row) expect(result.rawTextChunks).toEqual(row.chunks);
    if ('fields' in row) expect(result.fields).toMatchObject(row.fields!);
    if ('officialSignatureValid' in row && row.officialSignatureValid === false) expect(result.novelaiSignature).toBe('not-checked');
    expect(result.novelaiSignature).not.toBe('verified');
  });
});
