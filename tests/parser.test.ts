import { describe, expect, it } from 'vitest';
import { classifyTextChunks, inspectImage } from '../src/metadata/inspect';
import { artworkIdFromUrl, validatePixivImageUrl } from '../src/pixiv/artworks';

const enc = new TextEncoder();
const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
function pngWithText(entries: Record<string,string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [key, value] of Object.entries(entries)) {
    const body = enc.encode(`${key}\u0000${value}`);
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, body.length);
    const crcPlaceholder = new Uint8Array(4); // Tests parser bounds, not PNG decoder validity.
    const chunk = new Uint8Array([...len, ...enc.encode('tEXt'), ...body, ...crcPlaceholder]);
    chunks.push(chunk);
  }
  const iend = new Uint8Array([0,0,0,0,73,69,78,68,0,0,0,0]);
  return new Uint8Array([...signature, ...chunks.flatMap(c => Array.from(c)), ...iend]);
}

describe('PNG identification and metadata', () => {
  it('parses simple NovelAI text chunks, without claiming signature verification', () => {
    const output = inspectImage(pngWithText({Software:'NovelAI', Description:'1girl, blue hair', Comment: JSON.stringify({ seed: 123, signed_hash: 'unverified' })}));
    expect(output.generator).toBe('novelai'); expect(output.fields.prompt).toBe('1girl, blue hair');
    expect(output.novelaiSignature).toBe('not-checked');
  });
  it('recognizes ComfyUI workflow metadata', () => {
    const result = inspectImage(pngWithText({ workflow: JSON.stringify({ nodes: [] }), prompt: JSON.stringify({}) }));
    expect(result.generator).toBe('comfyui');
  });
  it('does not invent a generator when no evidence', () => {
    expect(classifyTextChunks({ Description: 'hello' }).generator).toBe('unknown');
  });
  it('fails safely for truncated chunks', () => {
    const original = pngWithText({Software:'NovelAI'});
    expect(inspectImage(original.subarray(0, original.length - 14)).status).toBe('parse-error');
  });
  it('does not mistake a jpeg for a png', () => {
    expect(inspectImage(new Uint8Array([255,216,255,224])).status).toBe('unsupported-format');
  });
});

describe('pixiv URL handling', () => {
  it('accepts only artwork pages', () => {
    expect(artworkIdFromUrl('https://www.pixiv.net/artworks/123456')).toBe('123456');
    expect(artworkIdFromUrl('https://evil.example/artworks/123456')).toBeNull();
  });
  it('restricts fetch URLs to the original image host and directory', () => {
    expect(() => validatePixivImageUrl('https://i.pximg.net/img-original/img/x.png')).not.toThrow();
    expect(() => validatePixivImageUrl('https://evil.example/img-original/x.png')).toThrow();
    expect(() => validatePixivImageUrl('https://i.pximg.net/img-master/x.jpg')).toThrow();
  });
});
