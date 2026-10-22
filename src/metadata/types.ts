export type GeneratorKind = 'novelai' | 'comfyui' | 'a1111-forge' | 'unknown';
export type Confidence = 'metadata-indicates' | 'weak' | 'unknown';
export type InspectionStatus = 'found' | 'no-metadata' | 'unsupported-format' | 'access-denied' | 'too-large' | 'parse-error' | 'cancelled' | 'busy';
export interface TextEntry { keyword: string; value: string; kind: 'tEXt' | 'zTXt' | 'iTXt' }
export interface Evidence { kind: GeneratorKind; source: string; detail: string }
export interface InspectionResult {
  status: InspectionStatus;
  format: 'png' | 'jpeg' | 'webp' | 'other';
  generator: GeneratorKind;
  detected: GeneratorKind[];
  confidence: Confidence;
  /** Only an actual cryptographic verifier may ever produce verified/invalid. */
  novelaiSignature: 'not-checked' | 'not-present' | 'verified' | 'invalid';
  evidence: Evidence[];
  fields: Record<string, string>;
  rawTextChunks: Record<string, string>;
  textEntries: TextEntry[];
  notes: string[];
  source?: { kind: 'pixiv'; artworkId: string; page: number; url: string } | { kind: 'local'; name: string };
}

export function emptyResult(status: InspectionStatus, notes: string[], format: InspectionResult['format'] = 'other'): InspectionResult {
  return { status, format, generator: 'unknown', detected: [], confidence: 'unknown', novelaiSignature: 'not-checked', evidence: [], fields: {}, rawTextChunks: {}, textEntries: [], notes };
}
