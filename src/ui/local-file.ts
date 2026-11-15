import { InspectionError, MAX_IMAGE_BYTES, readBounded } from '../limits';
import { inspectImage } from '../metadata/inspect';
import { emptyResult, type InspectionResult } from '../metadata/types';

export async function inspectLocalFile(file: File, signal: AbortSignal): Promise<InspectionResult> {
  try {
    if (file.size > MAX_IMAGE_BYTES) throw new InspectionError('too-large');
    const bytes = await readBounded(file.stream(), MAX_IMAGE_BYTES, signal);
    return { ...await inspectImage(bytes, signal), source: { kind: 'local', name: file.name } };
  } catch (error) {
    if (signal.aborted) return emptyResult('cancelled', ['検査を取り消しました。']);
    return emptyResult(error instanceof InspectionError && error.code === 'too-large' ? 'too-large' : 'parse-error', ['ファイルを読み込めませんでした。上限は48 MiBです。']);
  }
}
