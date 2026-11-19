import { wasParsed, type InspectionResult } from '../metadata/types';

const STATUS: Record<InspectionResult['status'], { label: string; tone: '' | 'ok' | 'warn' }> = {
  found: { label: 'テキスト情報あり', tone: 'ok' },
  'no-metadata': { label: '対応範囲にメタデータなし', tone: '' },
  'unsupported-format': { label: '未対応形式', tone: '' },
  'access-denied': { label: '取得不能', tone: 'warn' },
  'too-large': { label: '安全上限超過', tone: 'warn' },
  'parse-error': { label: '解析失敗', tone: 'warn' },
  cancelled: { label: '取り消し', tone: '' },
  busy: { label: '検査中', tone: '' },
};
const LONG_FIELD = /(?:^| )(?:prompt|negative)$/i;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function pre(text: string): HTMLPreElement {
  const node = element('pre', text); node.tabIndex = 0; return node;
}
function disclosure(label: string, text: () => string): HTMLDetailsElement {
  const details = element('details');
  details.append(element('summary', label));
  // Lazy: large JSON/RAW is only materialised when the user opens it.
  details.addEventListener('toggle', () => {
    if (details.open && details.children.length === 1) details.append(pre(text()));
  });
  return details;
}
const label = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

export function signatureText(result: InspectionResult): string {
  if (result.novelaiSignature === 'verified') return 'NovelAI電子署名: 検証成功';
  if (result.novelaiSignature === 'invalid') return 'NovelAI電子署名: 検証失敗';
  if (result.novelaiSignature === 'not-checked') return 'NovelAI電子署名: 未検証（署名データの記載あり。暗号学的検証は未実装）';
  return result.stealth === 'not-checked' ? 'NovelAI電子署名: 通常テキストに署名データなし（Stealth未検査）' : 'NovelAI電子署名: 通常テキスト・Stealthに署名データなし';
}
export function stealthText(result: InspectionResult): string {
  return result.stealth === 'found' ? 'Stealth（アルファチャンネル）: stealth_pngcompデータあり'
    : result.stealth === 'not-present' ? 'Stealth（アルファチャンネル）: なし'
    : 'Stealth（アルファチャンネル）: 未検査（注記を参照）';
}
export function summaryText(result: InspectionResult): string {
  const parts = [STATUS[result.status].label];
  if (wasParsed(result) || result.status === 'unsupported-format' || result.status === 'parse-error') parts.push(result.format);
  if (wasParsed(result)) parts.push(result.detected.length ? `メタデータから推定: ${result.detected.join(' / ')}` : '生成元は不明');
  return parts.join(' / ');
}

export function resultText(result: InspectionResult): string {
  const provenance = wasParsed(result) && result.format === 'png' ? [signatureText(result), stealthText(result)] : [];
  return [
    summaryText(result), `判定の強さ: ${result.confidence}`, ...provenance,
    ...Object.entries(result.fields).map(([key, value]) => `${key}:\n${value}`),
    ...result.notes,
  ].join('\n\n');
}

/** All metadata, labels and filenames are plain text. No HTML/markdown renderer. */
export function renderResult(container: HTMLElement, result: InspectionResult): void {
  container.replaceChildren();
  const feedback = element('span', '', 'copy-feedback'); feedback.setAttribute('role', 'status');
  const copyButton = (text: string, value: () => string, accessible?: string) => {
    const button = element('button', text); button.type = 'button';
    if (accessible) button.setAttribute('aria-label', accessible);
    button.addEventListener('click', () => {
      void (async () => {
        try { await navigator.clipboard.writeText(value()); feedback.textContent = 'コピーしました。'; }
        catch { feedback.textContent = 'コピーが許可されませんでした。表示テキストを選択してコピーしてください。'; }
      })();
    });
    return button;
  };

  const summary = element('p', undefined, 'result-summary');
  const badge = element('span', STATUS[result.status].label, `badge ${STATUS[result.status].tone}`.trim());
  summary.append(badge, document.createTextNode(summaryText(result).slice(STATUS[result.status].label.length)));
  container.append(summary);
  if (result.source) {
    container.append(element('p', result.source.kind === 'local' ? `ローカル: ${result.source.name}` : `作品 ${result.source.artworkId} / ${result.source.page + 1}枚目`, 'result-source'));
  }

  const parsed = wasParsed(result);
  if (!parsed) {
    // Failures first: what happened, why, and what the user can do next.
    const problem = element('div', undefined, 'result-problem');
    for (const note of result.notes) problem.append(element('p', note));
    if (result.notes.length) container.append(problem);
  }

  for (const [key, value] of Object.entries(result.fields)) {
    if (!LONG_FIELD.test(key)) continue;
    const head = element('div', undefined, 'field-head');
    head.append(element('h4', label(key)), copyButton('コピー', () => value, `${label(key)}をコピー`));
    container.append(head, pre(value));
  }
  const settings = element('dl', undefined, 'metadata-settings');
  for (const [key, value] of Object.entries(result.fields)) {
    if (LONG_FIELD.test(key) || key.startsWith('ComfyUI')) continue;
    settings.append(element('dt', label(key)), element('dd', value));
  }
  if (settings.children.length) container.append(settings);
  for (const [key, value] of Object.entries(result.fields)) if (key.startsWith('ComfyUI')) container.append(disclosure(key, () => value));

  if (parsed) {
    const provenance = element('div', undefined, 'provenance');
    for (const item of result.evidence) provenance.append(element('p', `根拠 [${item.source}]: ${item.detail}`));
    if (result.format === 'png') provenance.append(element('p', signatureText(result)), element('p', stealthText(result)));
    if (provenance.children.length) container.append(provenance);
  }
  if (result.source?.kind === 'pixiv') { const url = result.source.url; container.append(disclosure('解析対象URL', () => url)); }
  if (result.textEntries.length) container.append(disclosure('RAWテキスト（重複・Stealth・EXIFを含む）', () => JSON.stringify(result.textEntries, null, 2)));
  if (parsed && result.notes.length) {
    const notes = element('div', undefined, 'result-notes');
    for (const note of result.notes) notes.append(element('p', note));
    container.append(notes);
  }

  const buttons = element('div', undefined, 'buttons');
  buttons.append(copyButton('結果をコピー', () => resultText(result)), copyButton('正規化JSONをコピー', () => JSON.stringify(result, null, 2)));
  if (result.source?.kind === 'pixiv') { const url = result.source.url; buttons.append(copyButton('URLをコピー', () => url)); }
  buttons.append(feedback);
  container.append(buttons);
}
