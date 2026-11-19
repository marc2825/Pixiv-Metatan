import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectImage } from '../src/metadata/inspect';
import expected from './reference/fixtures/expected.json' with { type: 'json' };

type Row = (typeof expected.rows)[number] & { stealth?: string; exifUserComment?: string; officialStealthKeys?: string[] };

describe('independent fixtures written/read by pinned upstream NovelAI, ComfyUI and AUTOMATIC1111 code', () => {
  it.each(expected.rows as Row[])('$file matches upstream-verified metadata and classification', async row => {
    const bytes = new Uint8Array(readFileSync(new URL(`./reference/fixtures/${row.file}`, import.meta.url)));
    const result = await inspectImage(bytes);
    expect(result.status).toBe(row.status); expect(result.format).toBe(row.format); expect(result.generator).toBe(row.generator);
    if ('chunks' in row && row.chunks) expect(result.rawTextChunks).toEqual(row.chunks);
    if ('fields' in row && row.fields) expect(result.fields).toMatchObject(row.fields);
    if (row.stealth) expect(result.stealth).toBe(row.stealth);
    if (row.officialStealthKeys) {
      // Same top-level keys the official nai_meta.py reader returned (Title is dropped by the writer).
      expect(result.textEntries.filter(entry => entry.kind === 'stealth').map(entry => entry.keyword).sort()).toEqual(row.officialStealthKeys);
    }
    if (row.exifUserComment) expect(result.textEntries).toContainEqual({ keyword: 'Exif.UserComment', value: row.exifUserComment, kind: 'exif' });
    if ('officialSignatureValid' in row && row.officialSignatureValid === false) expect(result.novelaiSignature).toBe('not-checked');
    expect(result.novelaiSignature).not.toBe('verified');
    expect(result.novelaiSignature).not.toBe('invalid');
  });
});
