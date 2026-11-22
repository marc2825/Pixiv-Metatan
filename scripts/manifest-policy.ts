/**
 * The built manifest must request exactly the documented minimum (SECURITY.md). Pure function so it
 * can be unit-tested with synthetic manifests; scripts/check-manifest.ts applies it to .output/.
 */
const EXPECTED_PERMISSIONS = ['declarativeNetRequestWithHostAccess'];
const EXPECTED_HOSTS = ['https://www.pixiv.net/*', 'https://i.pximg.net/*'];
const CONTENT_MATCHES = ['https://www.pixiv.net/*'];
const CONTENT_JS = /^content-scripts\/[a-z0-9-]+\.js$/;
const FORBIDDEN_KEYS = [
  'externally_connectable', 'web_accessible_resources', 'content_security_policy', 'optional_permissions',
  'optional_host_permissions', 'declarative_net_request', 'oauth2', 'key', 'update_url', 'sandbox',
  'chrome_url_overrides', 'devtools_page', 'options_page', 'options_ui', 'side_panel',
];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const sameSet = (actual: unknown, expected: string[]) =>
  Array.isArray(actual) && actual.every(item => typeof item === 'string') && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

export function manifestProblems(manifest: unknown, packageVersion: string): string[] {
  if (!isObject(manifest)) return ['manifest is not an object'];
  const problems: string[] = [];
  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (manifest.version !== packageVersion) problems.push(`version ${JSON.stringify(manifest.version)} differs from package.json ${packageVersion}`);
  if (!sameSet(manifest.permissions ?? [], EXPECTED_PERMISSIONS)) problems.push(`permissions ${JSON.stringify(manifest.permissions)}`);
  if (!sameSet(manifest.host_permissions ?? [], EXPECTED_HOSTS)) problems.push(`host_permissions ${JSON.stringify(manifest.host_permissions)}`);
  for (const key of FORBIDDEN_KEYS) if (key in manifest) problems.push(`unexpected key ${key}`);

  // Exactly one top-frame, isolated-world content script for pixiv, with exactly one JS file.
  const scripts = manifest.content_scripts;
  if (!Array.isArray(scripts) || scripts.length !== 1) problems.push(`content_scripts must contain exactly 1 entry (found ${Array.isArray(scripts) ? scripts.length : 'none'})`);
  for (const script of Array.isArray(scripts) ? scripts : []) {
    if (!isObject(script)) { problems.push('content script is not an object'); continue; }
    if (!sameSet(script.matches, CONTENT_MATCHES)) problems.push(`content_scripts.matches ${JSON.stringify(script.matches)}`);
    if (!Array.isArray(script.js) || script.js.length !== 1 || !CONTENT_JS.test(String(script.js[0]))) problems.push(`content_scripts.js ${JSON.stringify(script.js)}`);
    if ('exclude_matches' in script || 'include_globs' in script) problems.push('content script must not change its match scope');
    if (script.all_frames) problems.push('content scripts must stay top-frame only');
    if (script.match_about_blank || script.match_origin_as_fallback) problems.push('content scripts must not run in about:/opaque frames');
    if (script.world !== undefined && script.world !== 'ISOLATED') problems.push(`content script world ${JSON.stringify(script.world)}`);
    if (script.run_at !== undefined && script.run_at !== 'document_idle') problems.push(`content script run_at ${JSON.stringify(script.run_at)}`);
  }

  const background = manifest.background;
  if (!isObject(background) || background.service_worker !== 'background.js' || 'scripts' in background || 'page' in background) {
    problems.push(`background must be the single service worker background.js (found ${JSON.stringify(background)})`);
  }
  // The toolbar action, when present, opens the local inspector page via onClicked (no popup).
  if (manifest.action !== undefined && (!isObject(manifest.action) || 'default_popup' in manifest.action)) problems.push('action must not define a popup');
  return problems;
}
