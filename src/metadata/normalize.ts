import { MAX_TEXT_BYTES } from '../limits';
import type { Confidence, Evidence, GeneratorKind, InspectionResult } from './types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bounded input plus iterative depth/node checks; never recurse into unknown JSON. */
export function parseMetadataJson(text: string): unknown {
  if (text.length > MAX_TEXT_BYTES) throw new Error('json-too-large');
  // Bound nesting before JSON.parse (and later JSON.stringify).
  let depth = 0, quoted = false, escape = false;
  for (const char of text) {
    if (quoted) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[' || char === '{') { if (++depth > 64) throw new Error('json-too-deep'); }
    else if (char === ']' || char === '}') depth--;
  }
  const value: unknown = JSON.parse(text);
  const queue = [value];
  let nodes = 0;
  while (queue.length) {
    if (++nodes > 50_000) throw new Error('json-too-many-values');
    const item = queue.pop();
    if (item && typeof item === 'object') {
      const values = Object.values(item);
      if (nodes + queue.length + values.length > 50_000) throw new Error('json-too-many-values');
      queue.push(...values);
    }
  }
  return value;
}

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
  const names: Record<string, string> = { Steps: 'steps', Sampler: 'sampler', 'CFG scale': 'cfg', Seed: 'seed', Size: 'size', Model: 'model', 'Model hash': 'model hash', VAE: 'vae', 'VAE hash': 'vae hash', 'Lora hashes': 'lora hashes', 'Schedule type': 'schedule type' };
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

export function classifyTextChunks(chunks: Record<string, string>) {
  const fields: Record<string, string> = Object.create(null);
  const notes: string[] = [];
  const evidence: Evidence[] = [];
  const readJson = (key: string): unknown => {
    if (!Object.hasOwn(chunks, key)) return undefined;
    try { return parseMetadataJson(chunks[key]!); }
    catch { notes.push(`${key}: JSONが不正、または複雑さの上限を超えています。RAWを確認してください。`); return undefined; }
  };
  const comment = readJson('Comment');
  const workflow = readJson('workflow');
  const prompt = readJson('prompt');
  // Do not infer NovelAI from generic steps/sampler or signed_hash alone.
  const novelai = /\bNovelAI\b/i.test(chunks.Software ?? '');
  if (novelai) {
    evidence.push({ kind: 'novelai', source: 'Software', detail: 'SoftwareがNovelAIを自己申告しています（署名の証明ではありません）。' });
    if (chunks.Description) fields.prompt = chunks.Description;
    if (chunks.Source) fields.model = chunks.Source;
    if (isRecord(comment)) {
      const names: Record<string, string> = { prompt: 'prompt', uc: 'negative', seed: 'seed', steps: 'steps', sampler: 'sampler', scale: 'cfg', width: 'width', height: 'height', model: 'model', noise_schedule: 'noise schedule' };
      for (const [key, name] of Object.entries(names)) {
        const value = comment[key];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[name] = String(value);
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
