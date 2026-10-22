import { isPng, parsePngTextChunks } from './png';
import { InspectionError, MAX_IMAGE_BYTES } from '../limits';
import { classifyTextChunks } from './normalize';
import { emptyResult, type InspectionResult } from './types';
export { classifyTextChunks } from './normalize';

export function imageFormat(bytes: Uint8Array): InspectionResult['format'] {
  if (isPng(bytes)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return 'other';
}

export async function inspectImage(bytes: Uint8Array, signal?: AbortSignal): Promise<InspectionResult> {
  if (bytes.length > MAX_IMAGE_BYTES) return emptyResult('too-large', ['ファイルサイズ上限（48 MiB）を超えています。']);
  const format = imageFormat(bytes);
  if (format !== 'png') return emptyResult('unsupported-format', ['PNGテキストのみ対応しています。JPEG/WebPのEXIF等は未解析です。未対応・情報の不在は非AI生成の証拠になりません。'], format);
  try {
    signal?.throwIfAborted();
    const parsed = await parsePngTextChunks(bytes, signal);
    const result = classifyTextChunks(parsed.text);
    return {
      ...emptyResult(parsed.entries.length ? 'found' : 'no-metadata', [], 'png'),
      generator: result.generator, detected: result.detected, confidence: result.confidence,
      novelaiSignature: parsed.entries.some(entry => entry.keyword === 'signed_hash' || (entry.keyword === 'Comment' && entry.value.includes('signed_hash'))) ? 'not-checked' : result.signature,
      fields: result.fields, evidence: result.evidence,
      rawTextChunks: parsed.text, textEntries: parsed.entries,
      notes: [...parsed.notes, ...result.notes,
        '画像内の自己申告データは第三者が編集できます。情報の不在は非AI生成の証拠になりません。',
        'Stealth・電子署名・画像画素は未検査です。not-presentは解析した通常テキスト内で署名が見つからない状態です。'],
    };
  } catch (error) {
    if (signal?.aborted) return emptyResult('cancelled', ['検査を取り消しました。'], 'png');
    const code = error instanceof InspectionError ? error.code : 'invalid-png-text';
    const large = ['too-large', 'text-too-large', 'pixel-limit', 'too-many-chunks'].includes(code);
    return emptyResult(large ? 'too-large' : 'parse-error', [`安全に解析できませんでした: ${code}`], 'png');
  }
}
