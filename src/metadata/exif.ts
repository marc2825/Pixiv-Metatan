import { InspectionError, MAX_TEXT_BYTES } from '../limits';
import type { TextEntry } from './types';

/**
 * Minimal, bounded EXIF text reader for JPEG (APP1 "Exif\0\0") and WebP (RIFF "EXIF").
 * Only text-bearing tags used by generation tools are read:
 * - Exif IFD UserComment (AUTOMATIC1111 / Forge store the "parameters" infotext here via piexif)
 * - IFD0 ImageDescription / Make / Model / Software / Artist (ComfyUI WebP stores
 *   "prompt:{json}" in Model and "workflow:{json}" in Make)
 * No pixels, thumbnails, maker notes, XMP or GPS are interpreted.
 */
export interface ExifText {
  entries: TextEntry[];
  /** Keys understood by the classifier (parameters, prompt, workflow, Software...). */
  classify: Record<string, string>;
  notes: string[];
}

const IFD0_TAGS: Record<number, string> = { 0x010e: 'ImageDescription', 0x010f: 'Make', 0x0110: 'Model', 0x0131: 'Software', 0x013b: 'Artist' };
const EXIF_IFD_POINTER = 0x8769, USER_COMMENT = 0x9286;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const latin1 = (bytes: Uint8Array) => {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return parts.join('');
};
const startsWith = (bytes: Uint8Array, text: string) => bytes.length >= text.length && [...text].every((c, i) => bytes[i] === c.charCodeAt(0));

/** Return TIFF bytes from the first APP1 Exif segment, stopping at SOS. */
export function jpegExif(bytes: Uint8Array): Uint8Array | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new InspectionError('not-jpeg');
  let offset = 2;
  for (let segments = 0; offset + 4 <= bytes.length; segments++) {
    if (segments > 1024) throw new InspectionError('too-many-jpeg-segments');
    if (bytes[offset] !== 0xff) throw new InspectionError('invalid-jpeg-marker');
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd9 || marker === 0xda) return;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) throw new InspectionError('malformed-jpeg-segment');
    const data = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xe1 && startsWith(data, 'Exif\0\0')) return data.subarray(6);
    offset += 2 + length;
  }
  // Every decodable JPEG reaches SOS; ending earlier means a truncated or non-JPEG file.
  throw new InspectionError('truncated-jpeg');
}

/** Return TIFF bytes from the first RIFF EXIF chunk. Some writers keep the "Exif\0\0" prefix. */
export function webpExif(bytes: Uint8Array): Uint8Array | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || !startsWith(bytes, 'RIFF') || latin1(bytes.subarray(8, 12)) !== 'WEBP') throw new InspectionError('not-webp');
  const end = 8 + view.getUint32(4, true);
  if (end > bytes.length || end < 12) throw new InspectionError('malformed-webp-length');
  let offset = 12;
  for (let chunks = 0; offset + 8 <= end; chunks++) {
    if (chunks > 1024) throw new InspectionError('too-many-webp-chunks');
    const tag = latin1(bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true);
    const dataEnd = offset + 8 + size;
    if (dataEnd > end) throw new InspectionError('malformed-webp-chunk');
    if (tag === 'EXIF') {
      const data = bytes.subarray(offset + 8, dataEnd);
      return startsWith(data, 'Exif\0\0') ? data.subarray(6) : data;
    }
    offset = dataEnd + (size & 1);
  }
  return undefined;
}

function decodeAscii(bytes: Uint8Array): string {
  const nul = bytes.indexOf(0);
  const text = nul < 0 ? bytes : bytes.subarray(0, nul);
  try { return utf8.decode(text); } catch { return latin1(text); }
}

/** EXIF 2.3 Table 9 character codes. UNICODE follows the TIFF byte order (piexif writes MM + UTF-16BE). */
function decodeUserComment(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.length < 8) return '';
  const prefix = latin1(bytes.subarray(0, 8)), body = bytes.subarray(8);
  let text: string;
  if (prefix === 'UNICODE\0') text = new TextDecoder(littleEndian ? 'utf-16le' : 'utf-16be').decode(body.subarray(0, body.length & ~1));
  else if (prefix === 'ASCII\0\0\0') text = decodeAscii(body);
  else if (prefix === 'JIS\0\0\0\0\0') text = new TextDecoder('shift_jis').decode(body);
  // Undefined code: AUTOMATIC1111 falls back to lenient UTF-8.
  else text = new TextDecoder('utf-8').decode(body);
  return text.replace(/\0+$/, '');
}

export function parseExifText(tiff: Uint8Array): ExifText {
  if (tiff.length < 8 || tiff.length > 64 * 1024 * 1024) throw new InspectionError('invalid-exif');
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const order = latin1(tiff.subarray(0, 2));
  if (order !== 'II' && order !== 'MM') throw new InspectionError('invalid-exif-byte-order');
  const le = order === 'II';
  if (view.getUint16(2, le) !== 42) throw new InspectionError('invalid-exif-magic');
  const result: ExifText = { entries: [], classify: Object.create(null), notes: [] };
  let budget = MAX_TEXT_BYTES;
  /**
   * The IFD structure (count, 12-byte entry headers) is always validated. An entry's value
   * (size and offset) is validated and read only when `wanted` selects it, so unrelated or
   * vendor tags (e.g. a large or broken MakerNote) cannot make the needed text fail (#13).
   * Wanted entries keep the strict checks and fail closed.
   */
  const readIfd = (offset: number, wanted: (tag: number, type: number) => boolean, visit: (tag: number, type: number, value: Uint8Array) => void) => {
    if (offset < 8 || offset + 2 > tiff.length) throw new InspectionError('malformed-exif-ifd');
    const count = view.getUint16(offset, le);
    if (count > 512 || offset + 2 + count * 12 > tiff.length) throw new InspectionError('malformed-exif-ifd');
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      const tag = view.getUint16(entry, le), type = view.getUint16(entry + 2, le);
      if (!wanted(tag, type)) continue;
      const unit = TYPE_SIZE[type]!, size = unit * view.getUint32(entry + 4, le);
      if (size > MAX_TEXT_BYTES) throw new InspectionError('text-too-large');
      const at = size <= 4 ? entry + 8 : view.getUint32(entry + 8, le);
      if (at + size > tiff.length) throw new InspectionError('malformed-exif-offset');
      visit(tag, type, tiff.subarray(at, at + size));
    }
  };
  const add = (keyword: string, value: string) => {
    budget -= value.length;
    if (budget < 0 || result.entries.length >= 128) throw new InspectionError('text-too-large');
    if (value) result.entries.push({ keyword, value, kind: 'exif' });
  };
  // Duplicated target tags: every value stays in RAW, the first one is used for classification.
  const classifyOnce = (key: string, value: string, label: string) => {
    if (Object.hasOwn(result.classify, key)) result.notes.push(`EXIFに${label}が重複しています。最初の値だけを判定に使います。`);
    else result.classify[key] = value;
  };
  let exifIfd: number | undefined;
  readIfd(view.getUint32(4, le), (tag, type) => (tag === EXIF_IFD_POINTER && (type === 4 || type === 13)) || (Object.hasOwn(IFD0_TAGS, tag) && type === 2), (tag, type, value) => {
    if (tag === EXIF_IFD_POINTER) {
      if (value.length !== 4) throw new InspectionError('malformed-exif-ifd');
      if (exifIfd === undefined) exifIfd = new DataView(value.buffer, value.byteOffset, 4).getUint32(0, le);
      else result.notes.push('EXIFのExif IFDポインタが重複しています。最初のものだけを読みます。');
      return;
    }
    const name = IFD0_TAGS[tag]!;
    const text = decodeAscii(value);
    add(`Exif.${name}`, text);
    // ComfyUI: "<extra_pnginfo key>:<json>" with prompt in Model, workflow from Make downwards.
    const comfy = /^(prompt|workflow):([\s\S]*)$/.exec(text);
    if (comfy && tag >= 0x0100 && tag <= 0x0110) classifyOnce(comfy[1]!, comfy[2]!, comfy[1]!);
    else if (name === 'Software' || name === 'ImageDescription') classifyOnce(name, text, name);
  });
  if (exifIfd !== undefined) {
    readIfd(exifIfd, (tag, type) => tag === USER_COMMENT && (type === 7 || type === 1 || type === 2), (_tag, _type, value) => {
      const text = decodeUserComment(value, le);
      add('Exif.UserComment', text);
      if (text) classifyOnce('parameters', text, 'UserComment');
    });
  }
  return result;
}
