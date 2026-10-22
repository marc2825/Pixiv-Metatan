import type { InspectionResult } from '../metadata/types';

function pre(text: string): HTMLPreElement {
  const element = document.createElement('pre'); element.textContent = text; element.tabIndex = 0; return element;
}
function disclosure(label: string, text: () => string): HTMLDetailsElement {
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = label;
  details.append(summary);
  details.addEventListener('toggle', () => {
    if (details.open && details.children.length === 1) details.append(pre(text()));
  });
  return details;
}
export function resultText(result: InspectionResult): string {
  return [
    `判定: ${result.detected.join(' / ') || '不明'} (${result.confidence})`,
    `状態: ${result.status}`, `NovelAI署名: ${result.novelaiSignature}`,
    ...Object.entries(result.fields).map(([key, value]) => `${key}:\n${value}`),
    ...result.notes,
  ].join('\n\n');
}

/** All metadata, labels and filenames are plain text. No HTML/markdown renderer. */
export function renderResult(container: HTMLElement, result: InspectionResult): void {
  container.replaceChildren();
  const summary = document.createElement('p');
  const statuses: Record<InspectionResult['status'], string> = { found: 'テキスト情報あり', 'no-metadata': '対応範囲にメタデータなし', 'unsupported-format': '未対応形式', 'access-denied': '取得不能', 'too-large': '安全上限超過', 'parse-error': '解析失敗', cancelled: '取り消し', busy: '検査中' };
  summary.textContent = `${statuses[result.status]} / ${result.format} / ${result.detected.length ? `メタデータから推定: ${result.detected.join(' / ')}` : '生成元は不明'}`;
  container.append(summary);
  const sig = document.createElement('p');
  const signatures = { 'not-checked': '未検証', 'not-present': '通常テキスト内に署名なし（Stealth未検査）', verified: '検証成功', invalid: '検証失敗' };
  sig.textContent = `NovelAI電子署名: ${signatures[result.novelaiSignature]}`;
  container.append(sig);
  if (result.source) {
    const source = document.createElement('p');
    source.textContent = result.source.kind === 'local' ? `ローカル: ${result.source.name}` : `作品 ${result.source.artworkId} / ${result.source.page + 1}枚目`;
    container.append(source);
    if (result.source.kind === 'pixiv') {
      const url = result.source.url;
      container.append(disclosure('解析対象URL', () => url));
    }
  }
  for (const item of result.evidence) {
    const p = document.createElement('p'); p.textContent = `根拠 [${item.source}]: ${item.detail}`; container.append(p);
  }
  for (const [key, value] of Object.entries(result.fields)) {
    if (key.startsWith('ComfyUI')) { container.append(disclosure(key, () => value)); continue; }
    const label = document.createElement('h4'); label.textContent = key;
    container.append(label, pre(value));
  }
  if (result.textEntries.length) container.append(disclosure('RAWテキストチャンク（重複を含む）', () => JSON.stringify(result.textEntries, null, 2)));
  for (const note of result.notes) {
    const p = document.createElement('p'); p.textContent = note; container.append(p);
  }
  const buttons = document.createElement('div'); buttons.className = 'buttons';
  const feedback = document.createElement('span'); feedback.setAttribute('role', 'status');
  const copies: [string, () => string][] = [
    ['結果をコピー', () => resultText(result)],
    ['正規化JSONをコピー', () => JSON.stringify(result, null, 2)],
  ];
  if (result.source?.kind === 'pixiv') { const url = result.source.url; copies.push(['URLをコピー', () => url]); }
  for (const [label, value] of copies) {
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = label;
    copy.addEventListener('click', () => {
      void (async () => {
        try { await navigator.clipboard.writeText(value()); feedback.textContent = 'コピーしました。'; }
        catch { feedback.textContent = 'コピーが許可されませんでした。表示テキストを選択してコピーしてください。'; }
      })();
    });
    buttons.append(copy);
  }
  container.append(buttons, feedback);
}
