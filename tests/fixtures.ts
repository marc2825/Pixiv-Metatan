import { deflateSync, gzipSync } from 'node:zlib';
export const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const enc = new TextEncoder();
export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
// Independent bitwise CRC, deliberately not the parser's table implementation.
export function chunk(tag: string, body = new Uint8Array()): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(body.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, body.length); bytes.set(enc.encode(tag), 4); bytes.set(body, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) {
    crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}
export function header(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(13), v = new DataView(h.buffer);
  v.setUint32(0, width); v.setUint32(4, height); h[8] = 8; h[9] = 6;
  return chunk('IHDR', h);
}
export function text(key: string, value: string, kind: 'tEXt' | 'zTXt' | 'iTXt' = 'tEXt', compressed = false): Uint8Array<ArrayBuffer> {
  const content = kind === 'iTXt' ? enc.encode(value) : new Uint8Array(Array.from(value, c => c.charCodeAt(0)));
  if (kind === 'tEXt') return chunk(kind, concat(enc.encode(key), new Uint8Array([0]), content));
  if (kind === 'zTXt') return chunk(kind, concat(enc.encode(key), new Uint8Array([0, 0]), deflateSync(content)));
  return chunk(kind, concat(enc.encode(key), new Uint8Array([0, compressed ? 1 : 0, 0, 0, 0]), compressed ? deflateSync(content) : content));
}
export const idat = () => chunk('IDAT', deflateSync(new Uint8Array([0, 0, 0, 0, 255])));
export function png(...entries: Uint8Array[]): Uint8Array<ArrayBuffer> { return concat(pngSignature, header(), ...entries, idat(), chunk('IEND')); }
export function pngWithText(entries: Record<string, string>): Uint8Array<ArrayBuffer> { return png(...Object.entries(entries).map(([k, v]) => text(k, v))); }
export const originalUrl = (id = '123', page = 0, extension = 'png') => `https://i.pximg.net/img-original/img/2026/10/22/00/00/00/${id}_p${page}.${extension}`;
export const previewUrl = (id = '123', page = 0) => `https://i.pximg.net/img-master/img/2026/10/22/00/00/00/${id}_p${page}_master1200.jpg`;
export const pagePayload = (id = '123', count = 2, previews = false) => ({ error: false, body: Array.from({ length: count }, (_, p) => ({ urls: { original: originalUrl(id, p), ...(previews ? { regular: previewUrl(id, p) } : {}) } })) });

// ---------------------------------------------------------------------------------------------
// Independent encoders for Stealth/EXIF edge cases (forward PNG filters, TIFF/JPEG/WebP writers).
// ---------------------------------------------------------------------------------------------
export function ihdr(width: number, height: number, depth = 8, color = 6, interlace = 0): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(13), v = new DataView(h.buffer);
  v.setUint32(0, width); v.setUint32(4, height); h[8] = depth; h[9] = color; h[12] = interlace;
  return chunk('IHDR', h);
}
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
/** Apply PNG forward filter `type` to one raw row (bpp bytes per pixel). */
export function filterRow(raw: Uint8Array, prev: Uint8Array, type: number, bpp: number): Uint8Array {
  const out = new Uint8Array(raw.length + 1); out[0] = type;
  for (let i = 0; i < raw.length; i++) {
    const a = i >= bpp ? raw[i - bpp]! : 0, b = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
    const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[i + 1] = (raw[i]! - pred) & 255;
  }
  return out;
}
/** Bytes that the official stealth reader would see: magic | uint32 BE bit length | payload. */
export function stealthStream(json: unknown, magic = 'stealth_pngcomp', lengthBits?: number, payload: Uint8Array = gzipSync(enc.encode(JSON.stringify(json)))): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(magic.length + 4);
  header.set(enc.encode(magic)); new DataView(header.buffer).setUint32(magic.length, lengthBits ?? payload.length * 8);
  return concat(header, payload);
}
/** RGBA/LA 8-bit PNG whose alpha LSBs carry `stream` column-major, like the official writer. */
export function stealthPng(width: number, height: number, stream: Uint8Array, options: { filters?: number[]; color?: 4 | 6; extra?: Uint8Array[]; corruptAfterRow?: number } = {}): Uint8Array<ArrayBuffer> {
  const channels = options.color === 4 ? 2 : 4, filters = options.filters ?? [0, 1, 2, 3, 4];
  const bits = stream.length * 8;
  let prev = new Uint8Array(width * channels);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < height; y++) {
    const raw = new Uint8Array(width * channels);
    for (let x = 0; x < width; x++) {
      const p = x * height + y;
      const bit = p < bits ? (stream[p >> 3]! >> (7 - (p & 7))) & 1 : 1;
      for (let c = 0; c < channels - 1; c++) raw[x * channels + c] = (x * 7 + y * 13 + c * 31) & 255;
      raw[x * channels + channels - 1] = (p < bits ? 0xfe : 0xff) | bit;
    }
    rows.push(filterRow(raw, prev, filters[y % filters.length]!, channels)); prev = raw;
  }
  if (options.corruptAfterRow !== undefined) for (const row of rows.slice(options.corruptAfterRow + 1)) row[0] = 9; // invalid filter type
  return concat(pngSignature, ihdr(width, height, 8, options.color ?? 6), ...(options.extra ?? []), chunk('IDAT', deflateSync(concat(...rows))), chunk('IEND'));
}

/** `raw` writes the count/offset fields verbatim with no data (for hostile or broken entries). */
export interface IfdEntry { tag: number; type: number; value: Uint8Array; raw?: { count: number; offset: number } }
/** Minimal TIFF writer: IFD0 entries plus an optional Exif IFD (pointer added automatically). */
export function tiff(order: 'II' | 'MM', ifd0: IfdEntry[], exif?: IfdEntry[]): Uint8Array<ArrayBuffer> {
  const le = order === 'II';
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const ifd0Entries = exif ? [...ifd0, { tag: 0x8769, type: 4, value: new Uint8Array(4) }] : ifd0;
  const ifd0At = 8, exifAt = ifd0At + ifdSize(ifd0Entries.length);
  let dataAt = exifAt + (exif ? ifdSize(exif.length) : 0);
  const parts: Uint8Array[] = [];
  const out = new Uint8Array(65536), view = new DataView(out.buffer);
  out.set(enc.encode(order)); view.setUint16(2, 42, le); view.setUint32(4, ifd0At, le);
  const write = (at: number, entries: IfdEntry[]) => {
    view.setUint16(at, entries.length, le);
    entries.forEach((entry, i) => {
      const e = at + 2 + i * 12;
      const unit = ({ 1: 1, 2: 1, 3: 2, 4: 4, 7: 1, 13: 4 } as Record<number, number>)[entry.type]!;
      view.setUint16(e, entry.tag, le); view.setUint16(e + 2, entry.type, le); view.setUint32(e + 4, entry.value.length / unit, le);
      if (entry.raw) { view.setUint32(e + 4, entry.raw.count, le); view.setUint32(e + 8, entry.raw.offset, le); return; }
      let value = entry.value;
      if (entry.tag === 0x8769) { value = new Uint8Array(4); new DataView(value.buffer).setUint32(0, exifAt, le); }
      if (value.length <= 4) out.set(value, e + 8);
      else { view.setUint32(e + 8, dataAt, le); out.set(value, dataAt); dataAt += value.length + (value.length & 1); }
    });
  };
  write(ifd0At, ifd0Entries); if (exif) write(exifAt, exif);
  parts.push(out.subarray(0, dataAt));
  return concat(...parts);
}
export const asciiValue = (text: string) => concat(enc.encode(text), new Uint8Array([0]));
export function userComment(text: string, code: 'UNICODE' | 'ASCII' | 'UNDEFINED', littleEndian = false): Uint8Array<ArrayBuffer> {
  const prefix = code === 'UNICODE' ? 'UNICODE\0' : code === 'ASCII' ? 'ASCII\0\0\0' : '\0'.repeat(8);
  if (code !== 'UNICODE') return concat(enc.encode(prefix), enc.encode(text));
  const body = new Uint8Array(text.length * 2), view = new DataView(body.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), littleEndian);
  return concat(enc.encode(prefix), body);
}
/** SOI | optional APP1 Exif | SOS | EOI. Data after SOS is never read by the metadata reader. */
export function jpeg(exifTiff?: Uint8Array): Uint8Array<ArrayBuffer> {
  const segment = (marker: number, data: Uint8Array) => {
    const head = new Uint8Array([0xff, marker, 0, 0]); new DataView(head.buffer).setUint16(2, data.length + 2);
    return concat(head, data);
  };
  return concat(new Uint8Array([0xff, 0xd8]), segment(0xe0, enc.encode('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(exifTiff ? [segment(0xe1, concat(enc.encode('Exif\0\0'), exifTiff))] : []), segment(0xda, new Uint8Array(6)), new Uint8Array([0, 0xff, 0xd9]));
}
export function webp(exifTiff?: Uint8Array, prefix = false): Uint8Array<ArrayBuffer> {
  const riffChunk = (tag: string, data: Uint8Array) => {
    const head = new Uint8Array(8); head.set(enc.encode(tag)); new DataView(head.buffer).setUint32(4, data.length, true);
    return concat(head, data, data.length & 1 ? new Uint8Array(1) : new Uint8Array());
  };
  const body = concat(enc.encode('WEBP'), riffChunk('VP8L', new Uint8Array(5)), ...(exifTiff ? [riffChunk('EXIF', prefix ? concat(enc.encode('Exif\0\0'), exifTiff) : exifTiff)] : []));
  const head = new Uint8Array(8); head.set(enc.encode('RIFF')); new DataView(head.buffer).setUint32(4, body.length, true);
  return concat(head, body);
}
