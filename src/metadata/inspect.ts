import { isPng, parsePngTextChunks } from './png';
import { InspectionError, MAX_IMAGE_BYTES } from '../limits';
import { jpegExif, parseExifText, webpExif } from './exif';
import { classifyTextChunks } from './normalize';
import { readStealth, type StealthResult } from './stealth';
import { emptyResult, type InspectionResult, type TextEntry } from './types';
export { classifyTextChunks } from './normalize';

export function imageFormat(bytes: Uint8Array): InspectionResult['format'] {
  if (isPng(bytes)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return 'other';
}

const SELF_REPORTED = '画像内の生成情報は自己申告で、第三者が編集・削除できます。情報の不在・未対応・取得不能は、人間が描いた証拠になりません。';
const NO_SIGNATURE_VERIFIER = 'NovelAI電子署名の暗号学的検証は未実装です。署名データがあっても「検証済み」にはしません。';
const STEALTH_REASONS: Record<string, string> = {
  'stealth-unsupported-layout': 'Stealth（アルファチャンネル）は8-bit・非インターレースのRGBA/グレー+アルファPNGだけ検査します。この画像は未検査です。',
  'stealth-uncompressed-unsupported': 'アルファチャンネルに非圧縮のstealth_pnginfoがあります。公式readerと同じくstealth_pngcompだけを読むため、内容は未解析です。',
  'stealth-too-large': 'Stealthデータが安全上限（圧縮1 MiB）を超えるため読み込みませんでした。',
  'stealth-text-too-large': 'Stealthデータの展開後が安全上限（2 MiB）を超えるため読み込みませんでした。',
  'stealth-truncated': 'Stealthの長さ情報が画像に収まりません。破損または別形式のため未解析です。',
  'stealth-invalid-gzip': 'Stealthの圧縮データを展開できませんでした。破損または別形式のため未解析です。',
  'stealth-too-many-keys': 'Stealthデータの項目数が上限を超えるため未解析です。',
  'stealth-row-too-large': '画像の幅が安全上限（1行1 MiB、RGBAで262,144px）を超えるため、Stealth（アルファチャンネル）は未検査です。通常テキストは解析済みです。',
};
const stealthNote = (stealth: StealthResult) => stealth.state === 'not-checked'
  ? STEALTH_REASONS[stealth.reason ?? ''] ?? `Stealth（アルファチャンネル）は画像データを読めないため未検査です: ${stealth.reason ?? 'unknown'}`
  : undefined;

/** Merge PNG text and Stealth classifications without letting either silently override the other. */
function classify(text: Record<string, string>, stealth: StealthResult) {
  const primary = classifyTextChunks(text);
  if (stealth.state !== 'found' || !stealth.data) return { ...primary, extraNotes: [] as string[] };
  const secondary = classifyTextChunks(stealth.data);
  const fields = { ...primary.fields };
  const differing: string[] = [];
  for (const [key, value] of Object.entries(secondary.fields)) {
    if (!Object.hasOwn(fields, key)) fields[key] = value;
    else if (fields[key] !== value) differing.push(key);
  }
  const evidence = [
    ...primary.evidence,
    { kind: secondary.generator, source: 'stealth_pngcomp', detail: 'アルファチャンネルにNovelAI形式（stealth_pngcomp）のデータがあります。形式の一致であり、生成元や署名の証明ではありません。' },
    ...secondary.evidence.map(item => ({ ...item, source: `Stealth ${item.source}` })),
  ];
  const detected = [...new Set([...primary.detected, ...secondary.detected])];
  const extraNotes = secondary.notes.map(note => `Stealth: ${note}`);
  if (differing.length) extraNotes.push(`通常テキストとStealthで値が異なります（${differing.join(', ')}）。通常テキスト側を表示し、両方をRAWに保持しました。`);
  return {
    generator: detected[0] ?? 'unknown' as const, detected, confidence: detected.length ? 'metadata-indicates' as const : 'unknown' as const,
    fields, evidence, notes: primary.notes,
    signature: primary.signature === 'not-checked' || secondary.signature === 'not-checked' ? 'not-checked' as const : 'not-present' as const,
    extraNotes,
  };
}

async function inspectPng(bytes: Uint8Array, signal?: AbortSignal): Promise<InspectionResult> {
  const parsed = await parsePngTextChunks(bytes, signal);
  const stealth = await readStealth(parsed, signal);
  signal?.throwIfAborted();
  const result = classify(parsed.text, stealth);
  const stealthEntries: TextEntry[] = stealth.state === 'found' && stealth.data
    ? Object.entries(stealth.data).map(([keyword, value]) => ({ keyword, value, kind: 'stealth' as const }))
    : [];
  const claimed = result.signature === 'not-checked'
    || parsed.entries.some(entry => entry.keyword === 'signed_hash' || (entry.keyword === 'Comment' && entry.value.includes('signed_hash')));
  const found = parsed.entries.length > 0 || stealthEntries.length > 0;
  return {
    ...emptyResult(found ? 'found' : 'no-metadata', [], 'png'),
    generator: result.generator, detected: result.detected, confidence: result.confidence,
    novelaiSignature: claimed ? 'not-checked' : 'not-present',
    stealth: stealth.state,
    fields: result.fields, evidence: result.evidence,
    rawTextChunks: parsed.text, textEntries: [...parsed.entries, ...stealthEntries],
    notes: [...parsed.notes, ...result.notes, ...result.extraNotes, ...[stealthNote(stealth)].filter((n): n is string => !!n), SELF_REPORTED, NO_SIGNATURE_VERIFIER],
  };
}

function inspectExif(bytes: Uint8Array, format: 'jpeg' | 'webp'): InspectionResult {
  const tiff = format === 'jpeg' ? jpegExif(bytes) : webpExif(bytes);
  const exif = tiff ? parseExifText(tiff) : { entries: [], classify: {}, notes: [] };
  const result = classifyTextChunks(exif.classify);
  const raw: Record<string, string> = Object.create(null);
  for (const entry of exif.entries) raw[entry.keyword] = entry.value;
  return {
    ...emptyResult(exif.entries.length ? 'found' : 'no-metadata', [], format),
    generator: result.generator, detected: result.detected, confidence: result.confidence,
    // A NovelAI signature lives in PNG text/alpha data; EXIF is not a supported carrier.
    novelaiSignature: result.signature,
    stealth: 'not-checked',
    fields: result.fields, evidence: result.evidence, rawTextChunks: raw, textEntries: exif.entries,
    notes: [...exif.notes, ...result.notes,
      `${format === 'jpeg' ? 'JPEG' : 'WebP'}はEXIFのUserComment・ImageDescription・Make・Model・Software・Artistだけを解析します。XMP・IPTC・画素は未検査です。`,
      SELF_REPORTED],
  };
}

export async function inspectImage(bytes: Uint8Array, signal?: AbortSignal): Promise<InspectionResult> {
  if (bytes.length > MAX_IMAGE_BYTES) return emptyResult('too-large', ['ファイルサイズ上限（48 MiB）を超えています。']);
  const format = imageFormat(bytes);
  if (format === 'other') return emptyResult('unsupported-format', ['PNG・JPEG・WebP以外は未対応です。未対応・情報の不在は非AI生成の証拠になりません。'], format);
  try {
    signal?.throwIfAborted();
    return format === 'png' ? await inspectPng(bytes, signal) : inspectExif(bytes, format);
  } catch (error) {
    if (signal?.aborted) return emptyResult('cancelled', ['検査を取り消しました。'], format);
    const code = error instanceof InspectionError ? error.code : 'invalid-metadata';
    const large = ['too-large', 'text-too-large', 'pixel-limit', 'too-many-chunks'].includes(code);
    return emptyResult(large ? 'too-large' : 'parse-error', [`安全に解析できませんでした: ${code}`], format);
  }
}
