import { isRecord, parseMetadataJson } from './json';
import type { Confidence, Evidence, GeneratorKind, InspectionResult } from './types';
export { isRecord, parseMetadataJson } from './json';

/** Commas inside quoted settings (e.g. model names) are not separators. */
export function parseParameters(text: string): Record<string, string> {
  const fields: Record<string, string> = Object.create(null);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const last = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1;
  const settings = lines[last] ?? '';
  if (!/^Steps:\s*\d+(?:,|$)/.test(settings)) return fields;
  const promptLines = lines.slice(0, last);
  const negative = promptLines.findIndex(line => line.startsWith('Negative prompt:'));
  fields.prompt = (negative < 0 ? promptLines : promptLines.slice(0, negative)).join('\n');
  if (negative >= 0) fields.negative = [promptLines[negative]!.slice('Negative prompt:'.length).trimStart(), ...promptLines.slice(negative + 1)].join('\n');
  const parts: string[] = [];
  let start = 0, quoted = false, escape = false;
  for (let i = 0; i < settings.length; i++) {
    const char = settings[i];
    if (escape) { escape = false; continue; }
    if (char === '\\' && quoted) { escape = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === ',' && !quoted) { parts.push(settings.slice(start, i)); start = i + 1; }
  }
  parts.push(settings.slice(start));
  const names: Record<string, string> = {
    Steps: 'steps', Sampler: 'sampler', 'Schedule type': 'schedule type', 'CFG scale': 'cfg', Seed: 'seed', Size: 'size',
    Model: 'model', 'Model hash': 'model hash', VAE: 'vae', 'VAE hash': 'vae hash', 'Clip skip': 'clip skip',
    'Denoising strength': 'denoising strength', 'Hires upscale': 'hires upscale', 'Hires steps': 'hires steps',
    'Hires upscaler': 'hires upscaler', 'Lora hashes': 'lora hashes', 'TI hashes': 'ti hashes', Version: 'version',
  };
  for (const part of parts) {
    const colon = part.indexOf(':');
    const name = part.slice(0, colon).trim();
    if (colon < 0 || !Object.hasOwn(names, name)) continue;
    let value = part.slice(colon + 1).trim();
    if (value.startsWith('"')) { try { const decoded: unknown = JSON.parse(value); if (typeof decoded === 'string') value = decoded; } catch { /* retain literal */ } }
    fields[names[name]!] = value;
  }
  return fields;
}

/**
 * NovelAI V4/V4.5 multi-character captions. Schema from the official image API definition
 * (image.novelai.net/docs/doc.json: RequestParameters.v4_prompt / v4_negative_prompt ->
 * V4ConditionInput { caption: { base_caption, char_captions: [{ char_caption, centers: [{x,y}] }] } }).
 * Values that do not match the schema are ignored (RAW still keeps them).
 */
export function v4Captions(value: unknown): { base?: string; characters: { caption: string; centers: string }[] } | undefined {
  if (!isRecord(value) || !isRecord(value.caption)) return undefined;
  const { base_caption: base, char_captions: list } = value.caption;
  if (base !== undefined && typeof base !== 'string') return undefined;
  if (list !== undefined && !Array.isArray(list)) return undefined;
  const characters: { caption: string; centers: string }[] = [];
  for (const item of (list ?? []).slice(0, 32)) {
    if (!isRecord(item) || typeof item.char_caption !== 'string') return undefined;
    const centers = Array.isArray(item.centers)
      ? item.centers.filter(isRecord).filter(c => typeof c.x === 'number' && typeof c.y === 'number').slice(0, 8).map(c => `(${c.x}, ${c.y})`).join(' ')
      : '';
    characters.push({ caption: item.char_caption, centers });
  }
  return { base, characters };
}

export function classifyTextChunks(chunks: Record<string, string>) {
  const fields: Record<string, string> = Object.create(null);
  const notes: string[] = [];
  const evidence: Evidence[] = [];
  const readJson = (key: string): unknown => {
    if (!Object.hasOwn(chunks, key)) return undefined;
    try { return parseMetadataJson(chunks[key]!); }
    catch { notes.push(`${key}: JSONが不正、または複雑さの上限を超えています。RAWを確認してください。`); return undefined; }
  };
  let comment = readJson('Comment');
  // Match the official reader's one-level Comment envelope. Keep original RAW.
  if (isRecord(comment) && Object.hasOwn(comment, 'Comment')) {
    try {
      if (typeof comment.Comment !== 'string') throw new Error('invalid-comment-envelope');
      const decoded = parseMetadataJson(comment.Comment);
      if (!isRecord(decoded)) throw new Error('invalid-comment-envelope');
      comment = decoded;
    } catch {
      notes.push('Comment.Comment: 内側のJSONが不正、または安全上限を超えています。RAWを確認してください。');
      comment = undefined;
    }
  }
  const workflow = readJson('workflow');
  const prompt = readJson('prompt');
  // Do not infer NovelAI from generic steps/sampler or signed_hash alone.
  const novelai = /\bNovelAI\b/i.test(chunks.Software ?? '');
  if (novelai) {
    evidence.push({ kind: 'novelai', source: 'Software', detail: 'SoftwareがNovelAIを自己申告しています（署名の証明ではありません）。' });
    if (chunks.Description) fields.prompt = chunks.Description;
    if (chunks.Source) fields.model = chunks.Source;
    if (isRecord(comment)) {
      const names: Record<string, string> = { prompt: 'prompt', uc: 'negative', seed: 'seed', steps: 'steps', sampler: 'sampler', scale: 'cfg', cfg_rescale: 'cfg rescale', width: 'width', height: 'height', model: 'model', noise_schedule: 'noise schedule' };
      for (const [key, name] of Object.entries(names)) {
        const value = comment[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[name] = String(value);
      }
      if (fields.negative === undefined && typeof comment.negative_prompt === 'string') fields.negative = comment.negative_prompt;
      const positive = v4Captions(comment.v4_prompt), negative = v4Captions(comment.v4_negative_prompt);
      if ((comment.v4_prompt !== undefined && !positive) || (comment.v4_negative_prompt !== undefined && !negative)) {
        notes.push('v4_prompt / v4_negative_prompt が公式APIスキーマと一致しません。RAWを確認してください。');
      }
      // Base captions normally duplicate prompt/uc; show them only when they add information.
      if (positive?.base !== undefined && positive.base !== fields.prompt) fields['base prompt'] = positive.base;
      if (negative?.base !== undefined && negative.base !== fields.negative) fields['base negative'] = negative.base;
      const count = Math.max(positive?.characters.length ?? 0, negative?.characters.length ?? 0);
      for (let i = 0; i < count; i++) {
        const p = positive?.characters[i], n = negative?.characters[i];
        if (p) fields[`character ${i + 1} prompt`] = p.caption;
        if (n && n.caption) fields[`character ${i + 1} negative`] = n.caption;
        if (p?.centers) fields[`character ${i + 1} position`] = p.centers;
      }
    }
  }
  const graph = isRecord(prompt) && Object.values(prompt).length > 0 && Object.values(prompt).every(node => isRecord(node) && typeof node.class_type === 'string' && isRecord(node.inputs));
  const hasWorkflow = isRecord(workflow) && Array.isArray(workflow.nodes) && workflow.nodes.every(isRecord);
  if (graph || hasWorkflow) {
    evidence.push({ kind: 'comfyui', source: graph ? 'prompt' : 'workflow', detail: 'ComfyUI形式のノード構成です。ComfyUIは利用ツールであり、生成モデルの証明ではありません。' });
    if (chunks.prompt) fields['ComfyUI API prompt JSON'] = chunks.prompt;
    if (chunks.workflow) fields['ComfyUI workflow JSON'] = chunks.workflow;
  }
  const parameters = chunks.parameters ? parseParameters(chunks.parameters) : {};
  if (Object.hasOwn(parameters, 'steps')) {
    evidence.push({ kind: 'a1111-forge', source: 'parameters', detail: 'AUTOMATIC1111/Forge互換の設定形式です。両者の区別や生成モデルの証明はできません。' });
    for (const [key, value] of Object.entries(parameters)) fields[novelai ? `A1111 ${key}` : key] = value;
  }
  const detected = evidence.map(item => item.kind);
  const generator: GeneratorKind = detected[0] ?? 'unknown';
  const confidence: Confidence = detected.length ? 'metadata-indicates' : 'unknown';
  // Invalid/missing claims cannot imply cryptographic invalidity or validity.
  const signature: InspectionResult['novelaiSignature'] = Object.hasOwn(chunks, 'signed_hash') || (isRecord(comment) && Object.hasOwn(comment, 'signed_hash')) || (chunks.Comment?.includes('signed_hash') ?? false) ? 'not-checked' : 'not-present';
  return { generator, detected, confidence, fields, evidence, signature, notes };
}
