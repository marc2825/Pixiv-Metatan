import { deflateSync } from 'node:zlib';
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
export const pagePayload = (id = '123', count = 2) => ({ error: false, body: Array.from({ length: count }, (_, p) => ({ urls: { original: originalUrl(id, p) } })) });
