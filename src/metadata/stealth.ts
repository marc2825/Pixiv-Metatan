import { InspectionError, MAX_STEALTH_BYTES, MAX_STEALTH_ROW_BYTES, MAX_TEXT_BYTES, readBounded } from '../limits';
import { isRecord, parseMetadataJson } from './json';
import type { StealthState } from './types';

/**
 * NovelAI "stealth_pngcomp": alpha-channel LSBs read column by column (the official
 * reader transposes the alpha plane), packed MSB-first into bytes:
 *   15-byte ASCII magic | uint32 BE payload length in bits | gzip(UTF-8 JSON) | optional FEC
 * Behaviour mirrors nai_meta.py at NovelAI/novelai-image-metadata@3428907 (MIT). The code is an
 * independent re-implementation; fixtures are written by the pinned official writer and read
 * back by the pinned official reader (see tests/reference/README.md).
 */
export const STEALTH_MAGIC = 'stealth_pngcomp';
/** Uncompressed variant used by some third-party tools. Not read by the official reader. */
const UNCOMPRESSED_MAGIC = 'stealth_pnginfo';
const HEADER_BYTES = STEALTH_MAGIC.length + 4;

export interface PngLayout {
  width: number; height: number; bitDepth: number; colorType: number; interlace: number;
  transparency: boolean; idat: Uint8Array[];
}
export interface StealthResult {
  state: StealthState;
  /** Top-level JSON keys as strings (non-strings are JSON-encoded), like PNG text chunks. */
  data?: Record<string, string>;
  /** Machine-readable reason for not-checked / not-present. */
  reason?: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

function unfilter(row: Uint8Array, prev: Uint8Array, filter: number, bpp: number): void {
  const n = row.length;
  switch (filter) {
    case 0: return;
    case 1: for (let i = bpp; i < n; i++) row[i] = row[i]! + row[i - bpp]!; return;
    case 2: for (let i = 0; i < n; i++) row[i] = row[i]! + prev[i]!; return;
    case 3:
      for (let i = 0; i < n; i++) row[i] = row[i]! + (((i >= bpp ? row[i - bpp]! : 0) + prev[i]!) >> 1);
      return;
    case 4:
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        row[i] = row[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      return;
    default: throw new InspectionError('stealth-invalid-filter');
  }
}

/** Feed IDAT views in small blocks so a highly compressible block cannot expand all at once. */
function idatStream(parts: Uint8Array[]): ReadableStream<Uint8Array<ArrayBuffer>> {
  let index = 0, offset = 0;
  return new ReadableStream({
    pull(controller) {
      while (index < parts.length && offset >= parts[index]!.length) { index++; offset = 0; }
      if (index >= parts.length) { controller.close(); return; }
      const part = parts[index]!, end = Math.min(offset + 4096, part.length);
      controller.enqueue(new Uint8Array(part.subarray(offset, end))); offset = end;
    },
  });
}

/**
 * Read the alpha LSB stream. Only 8-bit, non-interlaced grey+alpha / RGBA layouts are decoded.
 * The magic occupies the first 120 bits, i.e. column 0 of the first 120 rows when the image is at
 * least that tall, so non-stealth images stop after decoding at most 120 rows.
 */
export async function readStealth(png: PngLayout, signal?: AbortSignal): Promise<StealthResult> {
  const { width, height } = png;
  // The official reader converts to RGBA. Without an alpha source every LSB is 1 (alpha 255),
  // so the magic cannot be present.
  const alphaSource = png.colorType === 4 || png.colorType === 6 || png.transparency;
  if (!alphaSource) return { state: 'not-present', reason: 'stealth-no-alpha' };
  if (png.colorType !== 4 && png.colorType !== 6) return { state: 'not-checked', reason: 'stealth-unsupported-layout' };
  if (png.bitDepth !== 8 || png.interlace !== 0) return { state: 'not-checked', reason: 'stealth-unsupported-layout' };
  const totalBits = Math.floor((width * height) / 8) * 8;
  if (totalBits < HEADER_BYTES * 8) return { state: 'not-present', reason: 'stealth-too-small' };

  const channels = png.colorType === 6 ? 4 : 2;
  const rowBytes = width * channels, stride = rowBytes + 1;
  // Checked before any allocation: extreme aspect ratios pass MAX_PIXELS but need huge row buffers.
  if (!Number.isSafeInteger(rowBytes) || rowBytes > MAX_STEALTH_ROW_BYTES) return { state: 'not-checked', reason: 'stealth-row-too-large' };
  const maxBits = Math.min(totalBits, (HEADER_BYTES + MAX_STEALTH_BYTES) * 8);
  const columns = Math.min(width, Math.ceil(maxBits / height));
  const bits = new Uint8Array(Math.ceil((columns * height) / 8));
  const magicRow = Math.min(height, STEALTH_MAGIC.length * 8) - 1;
  const magicMatches = () => {
    const magic = ascii(bits.subarray(0, STEALTH_MAGIC.length));
    return magic === STEALTH_MAGIC ? 'compressed' : magic === UNCOMPRESSED_MAGIC ? 'uncompressed' : 'absent';
  };

  let prev = new Uint8Array(rowBytes), row = new Uint8Array(rowBytes);
  let y = 0, pos = 0, filter = 0, verdict: ReturnType<typeof magicMatches> | undefined;
  const reader = idatStream(png.idat).pipeThrough(new DecompressionStream('deflate')).getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    decode: while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      for (let i = 0; i < value.length;) {
        if (pos === 0) { filter = value[i++]!; pos = 1; continue; }
        const n = Math.min(stride - pos, value.length - i);
        row.set(value.subarray(i, i + n), pos - 1); i += n; pos += n;
        if (pos < stride) continue;
        unfilter(row, prev, filter, channels);
        for (let x = 0; x < columns; x++) {
          const p = x * height + y;
          if (p < totalBits && row[x * channels + channels - 1]! & 1) bits[p >> 3]! |= 0x80 >> (p & 7);
        }
        [prev, row] = [row, prev]; pos = 0;
        if (y === magicRow) {
          verdict = magicMatches();
          if (verdict !== 'compressed') break decode;
        }
        if (++y === height) break decode;
      }
    }
    if (verdict === 'absent') return { state: 'not-present', reason: 'stealth-magic-absent' };
    if (verdict === 'uncompressed') return { state: 'not-checked', reason: 'stealth-uncompressed-unsupported' };
    if (y !== height) return { state: 'not-checked', reason: 'stealth-image-data-truncated' };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { state: 'not-checked', reason: error instanceof InspectionError ? error.code : 'stealth-image-data-error' };
  } finally {
    cancel();
    signal?.removeEventListener('abort', cancel);
  }

  const lengthBits = new DataView(bits.buffer, STEALTH_MAGIC.length, 4).getUint32(0);
  const length = Math.floor(lengthBits / 8);
  const available = Math.floor(Math.min(columns * height, totalBits) / 8) - HEADER_BYTES;
  if (length > MAX_STEALTH_BYTES) return { state: 'not-checked', reason: 'stealth-too-large' };
  if (length === 0 || length > available) return { state: 'not-checked', reason: 'stealth-truncated' };
  let text: string;
  try {
    const payload = bits.slice(HEADER_BYTES, HEADER_BYTES + length);
    const input = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(c) { c.enqueue(payload); c.close(); } });
    text = utf8.decode(await readBounded(input.pipeThrough(new DecompressionStream('gzip')), MAX_TEXT_BYTES, signal));
  } catch (error) {
    if (signal?.aborted) throw error;
    return { state: 'not-checked', reason: error instanceof InspectionError && error.code === 'too-large' ? 'stealth-text-too-large' : 'stealth-invalid-gzip' };
  }
  let json: unknown;
  try { json = parseMetadataJson(text); } catch { json = undefined; }
  const data: Record<string, string> = Object.create(null);
  if (isRecord(json)) {
    const entries = Object.entries(json);
    if (entries.length > 128) return { state: 'not-checked', reason: 'stealth-too-many-keys' };
    for (const [key, value] of entries) data[key.slice(0, 200)] = typeof value === 'string' ? value : JSON.stringify(value);
  } else {
    // Not the official JSON layout; keep the decoded text for RAW review without guessing a tool.
    data['stealth text'] = text;
  }
  return { state: 'found', data };
}
