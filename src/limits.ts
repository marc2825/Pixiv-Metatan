export const MAX_IMAGE_BYTES = 48 * 1024 * 1024;
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_PAGES = 1000;
export const TIMEOUT_MS = 15_000;
/** Compressed NovelAI stealth payload cap (decompressed text still uses MAX_TEXT_BYTES). */
export const MAX_STEALTH_BYTES = 1024 * 1024;

export class InspectionError extends Error {
  /** `detail` is optional untrusted server text, length-limited and rendered as plain text only. */
  constructor(public readonly code: string, public readonly detail?: string) { super(code); }
}

/** Count actual bytes, including when Content-Length is absent or dishonest. */
export async function readBounded(
  stream: ReadableStream<Uint8Array>, limit: number, signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  // A growing buffer also bounds overhead from an adversarial stream of tiny chunks.
  let buffer = new Uint8Array(Math.min(64 * 1024, limit));
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      const nextSize = size + value.byteLength;
      if (nextSize > limit) throw new InspectionError('too-large');
      if (nextSize > buffer.length) {
        const grown = new Uint8Array(Math.min(limit, Math.max(nextSize, buffer.length * 2)));
        grown.set(buffer.subarray(0, size)); buffer = grown;
      }
      buffer.set(value, size); size = nextSize;
    }
    return size === buffer.length ? buffer : buffer.slice(0, size);
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function readResponse(response: Response, limit: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new InspectionError('too-large');
  }
  if (!response.body) throw new InspectionError('empty-body');
  return readBounded(response.body, limit, signal);
}
