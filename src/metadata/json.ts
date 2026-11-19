import { MAX_TEXT_BYTES } from '../limits';

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
  // JSON.parse defines "__proto__" as an own data property; it never changes a prototype.
  const value: unknown = JSON.parse(text);
  const queue = [value];
  let nodes = 0;
  while (queue.length) {
    if (++nodes > 50_000) throw new Error('json-too-many-values');
    const item = queue.pop();
    if (item && typeof item === 'object') {
      const values = Object.values(item);
      if (nodes + queue.length + values.length > 50_000) throw new Error('json-too-many-values');
      for (const child of values) queue.push(child);
    }
  }
  return value;
}
