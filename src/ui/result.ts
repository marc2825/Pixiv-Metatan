import { wasParsed, type GeneratorKind, type InspectionResult } from '../metadata/types';
import { failureReason, formatWait } from '../network/failures';
import { icon } from './icons';

const GENERATOR: Record<Exclude<GeneratorKind, 'unknown'>, string> = { novelai: 'NovelAI', comfyui: 'ComfyUI', 'a1111-forge': 'AUTOMATIC1111 / Forge' };

/**
 * How far a generator claim can be trusted. The last step needs a real cryptographic verifier,
 * which this build does not have, so it is shown as unavailable and never reached.
 */
export const TRUST_STEPS = ['書いてあるだけ', '署名あり・未確認', '署名を確認済み'] as const;

export interface Verdict { title: string; detail?: string; trust?: 0 | 1 | 2; failure: boolean }

const firstSentence = (text = '') => { const end = text.indexOf('。'); return end < 0 ? text : text.slice(0, end + 1); };

/** One plain sentence first: what the image says about itself, or why nothing could be read. */
export function verdict(result: InspectionResult): Verdict {
  switch (result.status) {
    case 'found': {
      const kinds = [...new Set(result.detected)].filter((kind): kind is Exclude<GeneratorKind, 'unknown'> => kind !== 'unknown');
      if (!kinds.length) return { title: '生成ツールは書かれていません', detail: 'テキスト情報はありますが、対応している生成ツールの形式とは一致しませんでした。', failure: false };
      const names = kinds.map(kind => GENERATOR[kind]);
      const title = kinds.length === 1 && kinds[0] === 'novelai' ? 'NovelAIで生成したと書かれています' : `${names.join('と')}の生成情報が入っています`;
      const graphOnly = kinds.includes('comfyui') && result.fields.prompt === undefined;
      const signed = result.format === 'png' && kinds.includes('novelai') && result.novelaiSignature === 'not-checked';
      return {
        title,
        detail: graphOnly ? 'どれがプロンプトかは決められないので、ノードのデータを開いて確かめてください。' : '画像に書かれた申告で、証明ではありません。',
        trust: result.novelaiSignature === 'verified' ? 2 : signed ? 1 : 0,
        failure: false,
      };
    }
    case 'no-metadata': return { title: '生成情報は見つかりませんでした', detail: '情報がないことは、人が描いた証拠にはなりません。', failure: false };
    case 'unsupported-format': return { title: '読めない形式です', detail: 'PNG・JPEG・WebPの生成情報に対応しています。', failure: false };
    case 'too-large': return { title: '大きすぎるため、読むのをやめました', detail: '安全のため、上限を超えたところで止めています。', failure: true };
    case 'parse-error': return { title: 'データが壊れているため、読めませんでした', failure: true };
    case 'cancelled': return { title: '取り消しました', failure: false };
    case 'busy': return { title: '別の画像を読み込んでいます', detail: '終わるか取り消してから、もう一度押してください。', failure: true };
    case 'access-denied': {
      const error = result.error;
      const title = error?.layer === 'pages' ? '画像の一覧を読み込めませんでした' : '原寸画像を読み込めませんでした';
      if (!error) return { title, detail: firstSentence(result.notes[0]), failure: true };
      const wait = error.retryAfterMs ? `あと約${formatWait(error.retryAfterMs)}は、このタブから読み込みません。` : '';
      return { title, detail: `${failureReason(error.code, error.layer)}${wait}`, failure: true };
    }
  }
}

const LABELS: Record<string, string> = {
  prompt: 'プロンプト', negative: 'ネガティブプロンプト', 'base prompt': 'ベースのプロンプト', 'base negative': 'ベースのネガティブプロンプト',
  seed: 'シード', steps: 'ステップ数', sampler: 'サンプラー', 'schedule type': 'スケジュール', 'noise schedule': 'ノイズスケジュール',
  cfg: 'CFGスケール', 'cfg rescale': 'CFGリスケール', size: 'サイズ', width: '幅', height: '高さ', model: 'モデル', 'model hash': 'モデルのハッシュ',
  vae: 'VAE', 'vae hash': 'VAEのハッシュ', 'clip skip': 'Clip skip', 'denoising strength': 'ノイズ除去の強さ', 'hires upscale': '高解像度化の倍率',
  'hires steps': '高解像度化のステップ数', 'hires upscaler': '高解像度化のアップスケーラー', 'lora hashes': 'LoRAのハッシュ', 'ti hashes': 'TIのハッシュ',
  version: 'バージョン', 'ComfyUI API prompt JSON': 'ComfyUIのノード（API形式のJSON）', 'ComfyUI workflow JSON': 'ComfyUIのワークフロー（JSON）',
};
/** Field keys come from the parsers; unknown keys are shown as they are (plain text). */
export function fieldLabel(key: string): string {
  if (Object.hasOwn(LABELS, key)) return LABELS[key]!;
  const character = /^character (\d+) (prompt|negative|position)$/.exec(key);
  if (character) return `キャラクター${character[1]}の${{ prompt: 'プロンプト', negative: 'ネガティブプロンプト', position: '位置' }[character[2] as 'prompt' | 'negative' | 'position']}`;
  if (key.startsWith('A1111 ')) return `${fieldLabel(key.slice(6))}（A1111形式）`;
  return key;
}
const LONG_FIELD = /(?:^| )(?:prompt|negative)$/i;

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
export function sourceText(result: InspectionResult): string | undefined {
  if (!result.source) return undefined;
  return result.source.kind === 'local' ? `手元のファイル: ${result.source.name}` : `作品 ${result.source.artworkId} の ${result.source.page + 1}枚目（原寸）`;
}
const formatText = (result: InspectionResult) => result.format === 'other' ? undefined : `形式: ${result.format.toUpperCase()}`;
const provenance = (result: InspectionResult) => wasParsed(result) && result.format === 'png' ? [signatureText(result), stealthText(result)] : [];

/** Plain-text copy of everything shown, in the same order. */
export function resultText(result: InspectionResult): string {
  const v = verdict(result);
  const fields = Object.entries(result.fields).map(([key, value]) => LONG_FIELD.test(key) || value.includes('\n') ? `${fieldLabel(key)}:\n${value}` : `${fieldLabel(key)}: ${value}`);
  return [
    [v.title, v.detail].filter(Boolean).join('\n'),
    ...(v.trust !== undefined ? [`確かさ: ${TRUST_STEPS[v.trust]}`] : []),
    ...[sourceText(result), formatText(result)].filter((line): line is string => !!line),
    ...fields, ...provenance(result), ...result.notes,
  ].join('\n\n');
}

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
  const details = element('details', undefined, 'raw');
  details.append(element('summary', label));
  // Lazy: large JSON/RAW is only materialised when the user opens it.
  details.addEventListener('toggle', () => {
    if (details.open && details.children.length === 1) details.append(pre(text()));
  });
  return details;
}

/** All metadata, labels and filenames are plain text. No HTML/markdown renderer. */
export function renderResult(container: HTMLElement, result: InspectionResult, context?: string): void {
  container.replaceChildren();
  // One live region for screen readers; each button also shows its own outcome where it was pressed.
  const announce = element('span', '', 'visually-hidden'); announce.setAttribute('role', 'status');
  const copyButton = (label: string, value: () => string, accessible = label) => {
    const button = element('button', undefined, 'copy'); button.type = 'button'; button.setAttribute('aria-label', accessible);
    const text = element('span', label);
    button.append(icon('copy'), text);
    let reset: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', () => {
      void (async () => {
        clearTimeout(reset);
        try {
          await navigator.clipboard.writeText(value());
          text.textContent = 'コピーしました'; button.firstChild!.replaceWith(icon('check')); button.classList.add('done');
          announce.textContent = 'コピーしました。';
        } catch {
          text.textContent = 'コピーできません'; button.classList.remove('done');
          announce.textContent = 'コピーが許可されませんでした。テキストを選んでコピーしてください。';
          if (!button.nextElementSibling?.classList.contains('copy-error')) button.after(element('span', '文字を選んでコピーしてください', 'copy-error'));
        }
        reset = setTimeout(() => { text.textContent = label; button.firstChild!.replaceWith(icon('copy')); button.classList.remove('done'); }, 1600);
      })();
    });
    return button;
  };

  const v = verdict(result);
  const head = element('div', undefined, v.failure ? 'verdict failure' : 'verdict');
  if (context) head.append(element('p', context, 'verdict-context'));
  head.append(element('h3', v.title, 'verdict-title'));
  if (v.detail) head.append(element('p', v.detail, 'verdict-detail'));
  if (v.trust !== undefined) {
    const scale = element('ol', undefined, 'trust-scale'); scale.setAttribute('aria-label', '申告の確かさ');
    // Break only where a reader would: after ・ and before （未対応）, never inside a word.
    const parts = [['書いてあるだけ'], ['署名あり・', '未確認'], ['署名を確認済み', '（未対応）']];
    TRUST_STEPS.forEach((_label, index) => {
      const step = element('li');
      parts[index]!.forEach((part, i) => { if (i) step.append(document.createElement('wbr')); step.append(part); });
      if (index === 2) step.classList.add('unavailable');
      if (index === v.trust) { step.classList.add('now'); step.setAttribute('aria-current', 'step'); }
      scale.append(step);
    });
    head.append(scale);
  }
  container.append(head);

  const fields = Object.entries(result.fields);
  const prompt = result.fields.prompt;
  if (prompt !== undefined) {
    const field = element('section', undefined, 'field');
    const top = element('div', undefined, 'field-head');
    top.append(element('h4', fieldLabel('prompt')), copyButton('コピー', () => prompt, `${fieldLabel('prompt')}をコピー`));
    const text = element('p', prompt, 'field-text'); text.tabIndex = 0;
    field.append(top, text);
    // Long prompts are clamped to keep the sheet short; the full text is one click away.
    if (prompt.length > 280 || prompt.split('\n').length > 6) {
      text.classList.add('clamped');
      const more = element('button', 'すべて表示', 'text-button'); more.type = 'button'; more.setAttribute('aria-expanded', 'false');
      more.addEventListener('click', () => {
        const open = text.classList.toggle('clamped') === false;
        more.textContent = open ? 'たたむ' : 'すべて表示'; more.setAttribute('aria-expanded', String(open));
      });
      field.append(more);
    }
    container.append(field);
  }
  for (const [key, value] of fields) {
    if (key === 'prompt' || !LONG_FIELD.test(key)) continue;
    const details = element('details', undefined, 'field');
    details.append(element('summary', fieldLabel(key)));
    const actions = element('div', undefined, 'field-actions'); actions.append(copyButton('コピー', () => value, `${fieldLabel(key)}をコピー`));
    const text = element('p', value, 'field-text'); text.tabIndex = 0;
    details.append(actions, text);
    container.append(details);
  }
  const settings = element('dl', undefined, 'settings');
  for (const [key, value] of fields) {
    if (LONG_FIELD.test(key) || key.startsWith('ComfyUI')) continue;
    const item = element('div'); item.append(element('dt', fieldLabel(key)), element('dd', value));
    settings.append(item);
  }
  if (settings.children.length) container.append(settings);
  for (const [key, value] of fields) if (key.startsWith('ComfyUI')) container.append(disclosure(fieldLabel(key), () => value));

  const more = element('details', undefined, 'result-more');
  more.append(element('summary', v.failure ? 'くわしい理由' : 'くわしい情報'));
  const body = element('div', undefined, 'result-more-body');
  for (const line of [sourceText(result), formatText(result)]) if (line) body.append(element('p', line));
  for (const item of result.evidence) body.append(element('p', `根拠（${item.source}）: ${item.detail}`));
  for (const line of provenance(result)) body.append(element('p', line));
  for (const note of result.notes) body.append(element('p', note, 'note'));
  if (result.source?.kind === 'pixiv') { const url = result.source.url; body.append(disclosure('解析したURL', () => url)); }
  if (result.textEntries.length) body.append(disclosure('生データ（重複・Stealth・EXIFを含む）', () => JSON.stringify(result.textEntries, null, 2)));
  const buttons = element('div', undefined, 'buttons');
  buttons.append(copyButton('結果をコピー', () => resultText(result)), copyButton('正規化JSONをコピー', () => JSON.stringify(result, null, 2)));
  if (result.source?.kind === 'pixiv') { const url = result.source.url; buttons.append(copyButton('URLをコピー', () => url)); }
  body.append(buttons);
  more.append(body);
  container.append(more, announce);
}
