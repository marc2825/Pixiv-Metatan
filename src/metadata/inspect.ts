import { isPng, parsePngTextChunks, MAX_IMAGE_BYTES } from './png';
import type { InspectionResult, GeneratorKind, Confidence } from './types';

function base(format: InspectionResult['format'], status: InspectionResult['status'], notes: string[]): InspectionResult {
  return {
    status, format, generator: 'unknown', confidence: 'unknown',
    novelaiSignature: 'not-checked', fields: {}, rawTextChunks: {}, notes,
  };
}

export function classifyTextChunks(chunks: Record<string, string>): {
  generator: GeneratorKind; confidence: Confidence; fields: Record<string, string>; signature: InspectionResult['novelaiSignature'];
} {
  const hasNovelAI = /novelai/i.test(chunks.Software ?? '') ||
    (typeof chunks.Comment === 'string' && /(?:"steps"|"sampler"|"signed_hash")/.test(chunks.Comment) && !!chunks.Description);
  const hasComfy = !!chunks.workflow || (!!chunks.prompt && /"class_type"/.test(chunks.prompt));
  const hasA1111 = !!chunks.parameters && /(?:Steps:|Sampler:|CFG scale:)/i.test(chunks.parameters);
  const generator: GeneratorKind = hasNovelAI ? 'novelai' : hasComfy ? 'comfyui' : hasA1111 ? 'a1111-forge' : 'unknown';
  const fields: Record<string, string> = {};
  let signature: InspectionResult['novelaiSignature'] = 'not-present';
  if (hasNovelAI) {
    if (chunks.Description) fields.prompt = chunks.Description;
    if (chunks.Comment) {
      try {
        const details: unknown = JSON.parse(chunks.Comment);
        if (details && typeof details === 'object' && !Array.isArray(details)) {
          for (const [k, v] of Object.entries(details)) {
            if (k === 'signed_hash') { signature = 'not-checked'; continue; }
            if (['uc', 'seed', 'steps', 'sampler', 'scale', 'width', 'height', 'char_captions'].includes(k)) {
              fields[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
          }
        }
      } catch { fields["comment (unparsed)"] = chunks.Comment ?? ""; }
    }
  } else if (hasComfy) {
    // No claim that a graph has one unique positive prompt or model.
    if (chunks.prompt) fields['ComfyUI API prompt JSON'] = chunks.prompt;
    if (chunks.workflow) fields['ComfyUI workflow JSON'] = chunks.workflow;
  } else if (hasA1111) fields.parameters = chunks.parameters ?? '';
  return { generator, confidence: generator === 'unknown' ? 'unknown' : 'metadata-indicates', fields, signature };
}

export function inspectImage(bytes: Uint8Array): InspectionResult {
  if (bytes.length > MAX_IMAGE_BYTES) return base('other', 'too-large', ['ファイルサイズ上限（48 MiB）を超えています。']);
  if (!isPng(bytes)) {
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
    return base(jpeg ? 'jpeg' : webp ? 'webp' : 'other', 'unsupported-format', ['初期版はPNGのテキストメタデータのみ対応します。']);
  }
  try {
    const rawTextChunks = parsePngTextChunks(bytes);
    const result = classifyTextChunks(rawTextChunks);
    return {
      status: Object.keys(rawTextChunks).length ? 'found' : 'no-metadata',
      generator: result.generator, confidence: result.confidence,
      format: 'png', novelaiSignature: result.signature,
      fields: result.fields, rawTextChunks,
      notes: ['初期版はtEXt/非圧縮iTXtのみ対応。圧縮テキスト・NovelAIのStealth情報・署名検証は未実装です。'],
    };
  } catch (error) {
    return base('png', 'parse-error', [error instanceof Error ? error.message : 'PNG解析失敗']);
  }
}
