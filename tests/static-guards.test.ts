import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level regression guards for the invariants in AGENTS.md / SECURITY.md. They complement
 * behavioural tests: a new sink, storage API, network API or host should be a deliberate,
 * reviewed change that also updates this file and the documentation.
 */
const root = new URL('..', import.meta.url).pathname;
function sources(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? sources(path) : /\.(ts|js|mjs)$/.test(name) ? [path] : [];
  });
}
const files = [...sources('src'), ...sources('entrypoints')].map(path => ({ path, code: readFileSync(join(root, path), 'utf8') }));
// Strip comments so documentation links and prose do not count as code.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const offenders = (pattern: RegExp) => files.filter(file => pattern.test(code(file.code))).map(file => relative(root, join(root, file.path)));

describe('static security guards for extension code', () => {
  it('has extension sources to check', () => expect(files.length).toBeGreaterThan(10));
  it.each([
    ['HTML/script injection sinks', /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function\b|createContextualFragment|DOMParser)\b/],
    ['string timers', /\bset(?:Timeout|Interval)\s*\(\s*['"`]/],
    ['persistent or shared storage', /\b(?:localStorage|sessionStorage|indexedDB|caches\.open|(?:browser|chrome)\.storage)\b/],
    ['cookie or credential APIs', /\b(?:document\.cookie|(?:browser|chrome)\.cookies|webRequest)\b/],
    ['other network APIs', /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(/],
    ['external messaging', /\bonMessageExternal\b|\bonConnectExternal\b|\bexternally_connectable\b/],
    ['navigation or popups', /\bwindow\.open\s*\(|location\.(?:assign|replace)\s*\(|location\.href\s*=[^=]/],
    ['page message bridge', /\bpostMessage\s*\(|addEventListener\(\s*['"]message['"]/],
  ])('contains no %s', (_name, pattern) => expect(offenders(pattern)).toEqual([]));

  it('only references pixiv and pximg hosts in code', () => {
    // The SVG XML namespace is an identifier passed to createElementNS, never fetched. Only that exact
    // string is exempt, and only in the icon module.
    const namespace = (file: { path: string }, text: string) => file.path.endsWith('ui/icons.ts') ? text.replace("'http://www.w3.org/2000/svg'", "''") : text;
    const hosts = new Set(files.flatMap(file => [...namespace(file, code(file.code)).matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map(match => match[1])));
    expect([...hosts].sort()).toEqual(['i.pximg.net', 'www.pixiv.net']);
  });
  it('creates object URLs only on the extension\'s own inspector page, never inside pixiv', () => {
    expect(offenders(/createObjectURL/)).toEqual(['src/ui/local-inspector.ts']);
  });
  it('fetches only in the pages adapter and the worker inspector', () => {
    expect(offenders(/\bfetch\b/).sort()).toEqual(['src/network/inspector.ts', 'src/pixiv/artworks.ts']);
  });
  it('keeps the worker original fetch without credentials, referrer or redirects', () => {
    const inspector = code(files.find(file => file.path.endsWith('network/inspector.ts'))!.code);
    expect(inspector).toMatch(/credentials:\s*'omit'/);
    expect(inspector).toMatch(/referrerPolicy:\s*'no-referrer'/);
    expect(inspector).toMatch(/redirect:\s*'error'/);
    expect(inspector).not.toMatch(/\breferrer:\s*['"`]|\bheaders\s*:/);
  });
  it('modifies headers only through the narrow Referer session rule (issue #9)', () => {
    expect(offenders(/declarativeNetRequest/)).toEqual(['entrypoints/background.ts']);
    expect(offenders(/updateSessionRules|updateDynamicRules|updateEnabledRulesets/)).toEqual(['src/network/referer-rule.ts']);
    const rule = code(files.find(file => file.path.endsWith('network/referer-rule.ts'))!.code);
    expect(rule).not.toMatch(/responseHeaders|Access-Control|Cookie|Origin'|redirect|'block'|allowAllRequests/);
    expect(rule).toMatch(/initiatorDomains: \[extensionId\]/); expect(rule).toMatch(/tabIds: \[TAB_ID_NONE\]/);
  });
  it('writes to the clipboard only from the result renderer', () => {
    expect(offenders(/navigator\.clipboard/)).toEqual(['src/ui/result.ts']);
  });
  it('listens for runtime messages only in the service worker', () => {
    expect(offenders(/runtime\.onMessage\b/)).toEqual(['entrypoints/background.ts']);
  });
});
