export type GeneratorKind = 'novelai' | 'comfyui' | 'a1111-forge' | 'unknown';
export type Confidence = 'metadata-indicates' | 'weak' | 'unknown';
export type InspectionStatus = 'found' | 'no-metadata' | 'unsupported-format' | 'access-denied' | 'too-large' | 'parse-error' | 'cancelled' | 'busy';
export type TextEntryKind = 'tEXt' | 'zTXt' | 'iTXt' | 'stealth' | 'exif';
export interface TextEntry { keyword: string; value: string; kind: TextEntryKind }
export interface Evidence { kind: GeneratorKind; source: string; detail: string }
/**
 * NovelAI alpha-channel `stealth_pngcomp` state.
 * - found: the official magic and a decodable payload were present.
 * - not-present: the alpha LSB stream was read (or the image cannot carry it) and the magic is absent.
 * - not-checked: unsupported layout/format, malformed payload, or nothing parsed.
 */
export type StealthState = 'found' | 'not-present' | 'not-checked';
/** Structured acquisition failure for UI decisions. Human-readable text stays in notes. */
export interface AccessFailure { layer: 'pages' | 'original'; code: string; retryAfterMs?: number }
export interface InspectionResult {
  status: InspectionStatus;
  format: 'png' | 'jpeg' | 'webp' | 'other';
  generator: GeneratorKind;
  detected: GeneratorKind[];
  confidence: Confidence;
  /** Only an actual cryptographic verifier may ever produce verified/invalid. This build has none. */
  novelaiSignature: 'not-checked' | 'not-present' | 'verified' | 'invalid';
  stealth: StealthState;
  evidence: Evidence[];
  fields: Record<string, string>;
  rawTextChunks: Record<string, string>;
  textEntries: TextEntry[];
  notes: string[];
  error?: AccessFailure;
  source?: { kind: 'pixiv'; artworkId: string; page: number; url: string } | { kind: 'local'; name: string };
}

export function emptyResult(status: InspectionStatus, notes: string[], format: InspectionResult['format'] = 'other'): InspectionResult {
  return { status, format, generator: 'unknown', detected: [], confidence: 'unknown', novelaiSignature: 'not-checked', stealth: 'not-checked', evidence: [], fields: {}, rawTextChunks: {}, textEntries: [], notes };
}

/** True when bytes were actually parsed, so signature/Stealth lines carry meaning. */
export function wasParsed(result: InspectionResult): boolean {
  return result.status === 'found' || result.status === 'no-metadata';
}
