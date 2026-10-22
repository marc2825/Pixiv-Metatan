export type GeneratorKind = 'novelai' | 'comfyui' | 'a1111-forge' | 'unknown';
export type Confidence = 'metadata-indicates' | 'weak' | 'unknown';
export type InspectionStatus =
  | 'found'
  | 'no-metadata'
  | 'unsupported-format'
  | 'access-denied'
  | 'too-large'
  | 'parse-error';

export interface InspectionResult {
  status: InspectionStatus;
  generator: GeneratorKind;
  confidence: Confidence;
  /** Presence of signed_hash IS NOT a verified NovelAI signature. */
  novelaiSignature: 'not-checked' | 'not-present' | 'verified' | 'invalid';
  format: 'png' | 'jpeg' | 'webp' | 'other';
  fields: Record<string, string>;
  /** Original text chunks; potentially long and untrusted, never render as HTML. */
  rawTextChunks: Record<string, string>;
  notes: string[];
}
