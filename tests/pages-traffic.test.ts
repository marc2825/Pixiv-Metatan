// @vitest-environment jsdom
/**
 * Reproducible synthetic benchmark for hover traffic (issue #14). It drives the real UI with fake
 * timers and a fake pages API (configurable latency, honours AbortSignal like fetch). It records
 * how many API requests start, how many are aborted mid-flight, and how long the final card takes
 * to show its page list (from its hover start, including the 250 ms intent delay). No real network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountInspector } from '../src/ui/app';
import { emptyResult } from '../src/metadata/types';
import { RateLimitError } from '../src/network/failures';
import { originalUrl, previewUrl } from './fixtures';

let root: ShadowRoot, destroy: (() => void) | undefined;
const attach = Element.prototype.attachShadow;
beforeEach(() => {
  vi.useFakeTimers(); history.replaceState({}, '', '/tags/synthetic/artworks');
  vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init) { root = attach.call(this, init); return root; });
});
afterEach(() => { destroy?.(); destroy = undefined; vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });

type Step = { card: number; dwell: number } | { gap: number };
interface Metrics { requests: number; aborted: number; finalMs: number | null }

async function run(steps: Step[], options: { latency?: number; cards?: number; rateLimitFirst?: boolean } = {}): Promise<Metrics> {
  const latency = options.latency ?? 400;
  let requests = 0, aborted = 0;
  const pages = vi.fn((id: string, signal?: AbortSignal) => {
    requests++;
    if (options.rateLimitFirst && requests === 1) return Promise.reject(new RateLimitError('pixiv-pages-http-429', 120_000));
    return new Promise<{ page: number; original: string; preview: string }[]>((resolve, reject) => {
      const timer = setTimeout(() => resolve([0, 1, 2].map(page => ({ page, original: originalUrl(id, page), preview: previewUrl(id, page) }))), latency);
      signal?.addEventListener('abort', () => { clearTimeout(timer); aborted++; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    });
  });
  destroy = mountInspector({ send: vi.fn().mockResolvedValue(emptyResult('found', [])), pages });
  const anchors = Array.from({ length: options.cards ?? 12 }, (_, i) => {
    const anchor = document.createElement('a'); anchor.href = `/artworks/${1000 + i}`;
    const img = document.createElement('img'); img.src = previewUrl(String(1000 + i)).replace('/img-master/', '/c/250x250_80_a2/img-master/'); img.alt = `Card ${i}`;
    anchor.append(img); document.body.append(anchor); return anchor;
  });
  let current: HTMLAnchorElement | undefined;
  const leave = () => { if (current) current.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })); current = undefined; };
  for (const step of steps) {
    leave();
    if ('gap' in step) { await vi.advanceTimersByTimeAsync(step.gap); continue; }
    current = anchors[step.card]!; current.querySelector('img')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(step.dwell);
  }
  // Stay on the last card until its page list is shown (or give up after 5 s).
  const last = [...steps].reverse().find((step): step is { card: number; dwell: number } => 'card' in step)!;
  const counter = () => root.querySelector('#metatan-preview .hover-counter')?.textContent;
  let waited = 0;
  const shown = () => counter() === '1 / 3' && root.querySelector('#metatan-preview h2')?.textContent === `Card ${last.card}`;
  while (!shown() && waited < 5000) { await vi.advanceTimersByTimeAsync(10); waited += 10; }
  return { requests, aborted, finalMs: shown() ? last.dwell + waited : null };
}

const sweep = (n: number, dwell: number, from = 0): Step[] => Array.from({ length: n }, (_, i) => ({ card: from + i, dwell }));
export const SCENARIOS: Record<string, { steps: Step[]; latency?: number; rateLimitFirst?: boolean }> = {
  'skim 10 cards, 100 ms each (below intent delay)': { steps: [...sweep(10, 100), { card: 10, dwell: 0 }] },
  'sweep 10 cards, 300 ms each': { steps: sweep(10, 300) },
  'leave (preview closes) and re-hover the same card': { steps: [{ card: 0, dwell: 300 }, { gap: 300 }, { card: 0, dwell: 0 }] },
  'A, then B (loaded), then back to A': { steps: [{ card: 0, dwell: 300 }, { card: 1, dwell: 1500 }, { card: 0, dwell: 0 }] },
  'sweep 5 cards on a slow API (1500 ms)': { steps: sweep(5, 300), latency: 1500 },
  '429 on the first request, then sweep 5': { steps: sweep(5, 300), rateLimitFirst: true },
};

/**
 * Measured with this harness on 2026-11-22. "before" = main at 4f078eb/3c82536 (strict queue, abort on
 * leave, no sweep delay); "after" = detached completion + join + sweep delay. The test asserts "after"
 * exactly (fake timers make it deterministic), so regressions in traffic or latency show up here.
 */
export const RESULTS: Record<string, { before: Metrics; after: Metrics }> = {
  'skim 10 cards, 100 ms each (below intent delay)': { before: { requests: 1, aborted: 0, finalMs: 650 }, after: { requests: 1, aborted: 0, finalMs: 650 } },
  'sweep 10 cards, 300 ms each': { before: { requests: 10, aborted: 9, finalMs: 650 }, after: { requests: 2, aborted: 0, finalMs: 800 } },
  'leave (preview closes) and re-hover the same card': { before: { requests: 2, aborted: 1, finalMs: 650 }, after: { requests: 1, aborted: 0, finalMs: 250 } },
  'A, then B (loaded), then back to A': { before: { requests: 3, aborted: 1, finalMs: 650 }, after: { requests: 2, aborted: 0, finalMs: 250 } },
  'sweep 5 cards on a slow API (1500 ms)': { before: { requests: 5, aborted: 4, finalMs: 1750 }, after: { requests: 2, aborted: 0, finalMs: 1900 } },
  '429 on the first request, then sweep 5': { before: { requests: 1, aborted: 0, finalMs: null }, after: { requests: 1, aborted: 0, finalMs: null } },
};

describe('hover pages-API traffic benchmark (synthetic, issue #14)', () => {
  const results: Record<string, Metrics> = {};
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(name, async () => {
      results[name] = await run(scenario.steps, scenario);
      expect(results[name]).toEqual(RESULTS[name]!.after);
      expect(results[name].requests).toBeLessThanOrEqual(RESULTS[name]!.before.requests);
    });
  }
  it('prints the table', () => {
    console.log('\n' + Object.entries(results).map(([name, m]) => `${name.padEnd(50)} requests=${m.requests} aborted=${m.aborted} final=${m.finalMs ?? 'n/a'}ms`).join('\n'));
  });
});
