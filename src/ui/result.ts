import type { InspectionResult } from '../metadata/types';

/** Never use innerHTML for untrusted prompt, source URLs, or metadata. */
export function renderResult(container: HTMLElement, result: InspectionResult): void {
  container.replaceChildren();
  const summary = document.createElement('p');
  summary.textContent = `判定: ${result.generator} / ${result.status} / 確度: ${result.confidence}`;
  container.appendChild(summary);
  const sig = document.createElement('small');
  sig.textContent = `NovelAI署名: ${result.novelaiSignature}（not-checkedは未検証）`;
  container.appendChild(sig);
  for (const [key, value] of Object.entries(result.fields)) {
    const label = document.createElement('h4'); label.textContent = key;
    const pre = document.createElement('pre'); pre.textContent = value;
    container.append(label, pre);
  }
  for (const note of result.notes) {
    const p = document.createElement('p'); p.textContent = note; container.appendChild(p);
  }
}
