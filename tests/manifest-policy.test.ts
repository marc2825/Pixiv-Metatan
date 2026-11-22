import { describe, expect, it } from 'vitest';
import { manifestProblems } from '../scripts/manifest-policy';

// Mirrors the WXT output for this project (checked against the real build by `npm run check:manifest`).
const good = () => ({
  manifest_version: 3, name: 'pixiv AI Metadata Inspector', description: 'x', version: '0.1.0',
  icons: { 16: 'icon/16.png', 128: 'icon/128.png' }, minimum_chrome_version: '120',
  permissions: ['declarativeNetRequestWithHostAccess'], host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
  background: { service_worker: 'background.js' },
  action: { default_title: 'x' },
  content_scripts: [{ matches: ['https://www.pixiv.net/*'], js: ['content-scripts/pixiv.js'] }],
});
type Manifest = ReturnType<typeof good> & Record<string, unknown>;
const variant = (change: (m: Manifest) => void) => { const m = good() as Manifest; change(m); return manifestProblems(m, '0.1.0'); };

describe('manifest policy (issue #16)', () => {
  it('accepts the intended Chrome/Edge manifest, with or without the action', () => {
    expect(manifestProblems(good(), '0.1.0')).toEqual([]);
    expect(variant(m => { delete (m as Partial<Manifest>).action; })).toEqual([]);
  });
  it.each<[string, (m: Manifest) => void, string]>([
    ['empty content scripts', m => { m.content_scripts = []; }, 'exactly 1 entry (found 0)'],
    ['missing content scripts', m => { delete (m as Partial<Manifest>).content_scripts; }, 'exactly 1 entry (found none)'],
    ['two content scripts', m => { m.content_scripts.push({ ...m.content_scripts[0]! }); }, 'exactly 1 entry (found 2)'],
    ['extra match host', m => { m.content_scripts[0]!.matches.push('https://*.pixiv.net/*'); }, 'content_scripts.matches'],
    ['all-URL match', m => { m.content_scripts[0]!.matches = ['<all_urls>']; }, 'content_scripts.matches'],
    ['no JS', m => { m.content_scripts[0]!.js = []; }, 'content_scripts.js'],
    ['two JS files', m => { m.content_scripts[0]!.js.push('content-scripts/other.js'); }, 'content_scripts.js'],
    ['JS outside content-scripts/', m => { m.content_scripts[0]!.js = ['../evil.js']; }, 'content_scripts.js'],
    ['all frames', m => { Object.assign(m.content_scripts[0]!, { all_frames: true }); }, 'top-frame only'],
    ['about:blank frames', m => { Object.assign(m.content_scripts[0]!, { match_about_blank: true }); }, 'about:/opaque'],
    ['main world', m => { Object.assign(m.content_scripts[0]!, { world: 'MAIN' }); }, 'world "MAIN"'],
    ['document_start', m => { Object.assign(m.content_scripts[0]!, { run_at: 'document_start' }); }, 'run_at'],
    ['glob scope change', m => { Object.assign(m.content_scripts[0]!, { exclude_matches: ['https://www.pixiv.net/ajax/*'] }); }, 'match scope'],
    ['extra API permission', m => { m.permissions.push('cookies'); }, 'permissions'],
    ['no permissions at all', m => { m.permissions = []; }, 'permissions'],
    ['broad host permission', m => { m.host_permissions.push('<all_urls>'); }, 'host_permissions'],
    ['static DNR ruleset', m => { m.declarative_net_request = { rule_resources: [] }; }, 'unexpected key declarative_net_request'],
    ['web accessible resources', m => { m.web_accessible_resources = []; }, 'unexpected key web_accessible_resources'],
    ['externally connectable', m => { m.externally_connectable = { matches: ['*://*/*'] }; }, 'unexpected key externally_connectable'],
    ['relaxed CSP', m => { m.content_security_policy = {}; }, 'unexpected key content_security_policy'],
    ['background scripts', m => { m.background = { scripts: ['a.js'] } as never; }, 'single service worker'],
    ['popup action', m => { m.action = { default_popup: 'popup.html' } as never; }, 'must not define a popup'],
    ['MV2', m => { m.manifest_version = 2 as never; }, 'manifest_version must be 3'],
  ])('rejects %s', (_name, change, message) => {
    expect(variant(change).join('\n')).toContain(message);
  });
  it('rejects a version that differs from package.json and non-object manifests', () => {
    expect(manifestProblems(good(), '0.2.0').join(' ')).toContain('differs from package.json');
    expect(manifestProblems(null, '0.1.0')).toEqual(['manifest is not an object']);
    expect(manifestProblems([], '0.1.0')).toEqual(['manifest is not an object']);
  });
});
