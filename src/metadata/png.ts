import { InspectionError, MAX_IMAGE_BYTES, MAX_PIXELS, MAX_TEXT_BYTES, readBounded } from '../limits';
import type { TextEntry } from './types';
export { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from '../limits';

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
// ignoreBOM keeps a leading U+FEFF as text instead of silently dropping it.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  // Indexed loop: this runs over every IDAT byte (up to 48 MiB).
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && signature.every((b, i) => bytes[i] === b);
}

// TextDecoder('latin1') is Windows-1252 in browsers, not PNG's ISO-8859-1.
function latin1(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return parts.join('');
}

export async function inflateBounded(bytes: Uint8Array, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  // Feed small compressed blocks to limit transient native inflater output too.
  // A Blob stream may otherwise feed a large, highly compressible block at once.
  let offset = 0;
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 1024, bytes.length);
      controller.enqueue(new Uint8Array(bytes.subarray(offset, end))); offset = end;
    },
  });
  try {
    return await readBounded(input.pipeThrough(new DecompressionStream('deflate')), limit, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof InspectionError) throw new InspectionError('text-too-large');
    throw new InspectionError('invalid-compressed-text');
  }
}

export interface PngMetadata {
  text: Record<string, string>;
  entries: TextEntry[];
  notes: string[];
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  /** tRNS present: a non-alpha image may still have per-pixel transparency. */
  transparency: boolean;
  /** Views into the input (no copies), in order, for the optional Stealth reader. */
  idat: Uint8Array[];
}

/** Structural/CRC validation and text only; this function never expands IDAT (see stealth.ts). */
export async function parsePngTextChunks(data: Uint8Array, signal?: AbortSignal): Promise<PngMetadata> {
  if (data.length > MAX_IMAGE_BYTES) throw new InspectionError('too-large');
  if (!isPng(data)) throw new InspectionError('not-png');
  const result: PngMetadata = { text: Object.create(null), entries: [], notes: [], width: 0, height: 0, bitDepth: 0, colorType: 0, interlace: 0, transparency: false, idat: [] };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8, count = 0, budget = MAX_TEXT_BYTES, encodedText = 0;
  let header = false, image = false, imageEnded = false, palette = false;
  let color = -1, depth = 0;
  while (offset + 12 <= data.length) {
    signal?.throwIfAborted();
    if (++count > 4096) throw new InspectionError('too-many-chunks');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > data.length) throw new InspectionError('malformed-png-length');
    const tag = latin1(data.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(tag)) throw new InspectionError('invalid-chunk-type');
    if (crc32(data.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new InspectionError('png-crc-mismatch');
    const part = data.subarray(offset + 8, end - 4);
    if (!header && tag !== 'IHDR') throw new InspectionError('missing-ihdr');
    if (tag === 'IHDR') {
      if (header || length !== 13) throw new InspectionError('invalid-ihdr');
      const h = new DataView(part.buffer, part.byteOffset, part.byteLength);
      result.width = h.getUint32(0); result.height = h.getUint32(4);
      depth = part[8]!; color = part[9]!;
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!result.width || !result.height || !depths[color]?.includes(depth) || part[10] !== 0 || part[11] !== 0 || part[12]! > 1) throw new InspectionError('invalid-ihdr');
      if (result.width * result.height > MAX_PIXELS) throw new InspectionError('pixel-limit');
      result.bitDepth = depth; result.colorType = color; result.interlace = part[12]!;
      header = true;
    } else if (tag === 'PLTE') {
      if (palette || image || color === 0 || color === 4 || !length || length % 3 || length > 768 || (color === 3 && length / 3 > 2 ** depth)) throw new InspectionError('invalid-palette');
      palette = true;
    } else if (tag === 'IDAT') {
      if (imageEnded || (color === 3 && !palette)) throw new InspectionError('invalid-idat-order');
      image = true; result.idat.push(part);
    } else if (tag === 'IEND') {
      if (length || !image || end !== data.length) throw new InspectionError('invalid-iend');
      return result;
    } else if (tag[0] === tag[0]!.toUpperCase()) {
      throw new InspectionError('unknown-critical-chunk');
    }
    if (image && tag !== 'IDAT') imageEnded = true;
    if (tag === 'tRNS') result.transparency = true;
    if (tag === 'acTL') result.notes.push('APNGのテキストのみ解析しました。アニメーション画素は未検査です。');
    if (tag === 'tEXt' || tag === 'zTXt' || tag === 'iTXt') {
      encodedText += length;
      if (encodedText > MAX_TEXT_BYTES || result.entries.length >= 128) throw new InspectionError('text-too-large');
      const nul = part.indexOf(0);
      const keywordBytes = part.subarray(0, nul < 0 ? 0 : nul);
      const keyword = latin1(keywordBytes);
      if (nul < 1 || nul > 79 || keywordBytes.some(b => b < 32 || (b > 126 && b < 161)) || keyword.startsWith(' ') || keyword.endsWith(' ') || keyword.includes('  ')) throw new InspectionError('invalid-png-keyword');
      let content = part.subarray(nul + 1), unicode = false;
      budget -= nul;
      if (budget < 0) throw new InspectionError('text-too-large');
      if (tag === 'zTXt') {
        if (content[0] !== 0) throw new InspectionError('invalid-compression-method');
        content = await inflateBounded(content.subarray(1), budget, signal);
      } else if (tag === 'iTXt') {
        const flag = part[nul + 1], method = part[nul + 2];
        const langEnd = part.indexOf(0, nul + 3);
        const translatedEnd = langEnd < 0 ? -1 : part.indexOf(0, langEnd + 1);
        if ((flag !== 0 && flag !== 1) || method !== 0 || langEnd < 0 || translatedEnd < 0 || part.subarray(nul + 3, langEnd).some(b => b > 127)) throw new InspectionError('invalid-itxt-header');
        utf8.decode(part.subarray(langEnd + 1, translatedEnd));
        content = part.subarray(translatedEnd + 1); unicode = true;
        if (flag === 1) content = await inflateBounded(content, budget, signal);
      }
      budget -= content.length;
      if (budget < 0) throw new InspectionError('text-too-large');
      const value = unicode ? utf8.decode(content) : latin1(content);
      if (value.includes('\0')) throw new InspectionError('invalid-text-nul');
      result.entries.push({ keyword, value, kind: tag });
      // Preserve all entries. Ambiguous keys are deliberately excluded from detection.
      if (Object.hasOwn(result.text, keyword)) {
        result.notes.push(`重複キー ${keyword}: RAWに全件保持し、判定から除外しました。`);
        delete result.text[keyword];
      } else if (!result.entries.slice(0, -1).some(entry => entry.keyword === keyword)) {
        result.text[keyword] = value;
      }
    }
    offset = end;
  }
  throw new InspectionError('missing-iend');
}
