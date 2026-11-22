// Fails if a built manifest requests more than the documented minimum (see SECURITY.md).
import { readFileSync } from 'node:fs';

const expected = {
  permissions: ['declarativeNetRequestWithHostAccess'],
  host_permissions: ['https://www.pixiv.net/*', 'https://i.pximg.net/*'],
  contentMatches: ['https://www.pixiv.net/*'],
};
const forbiddenKeys = ['externally_connectable', 'web_accessible_resources', 'content_security_policy', 'optional_permissions', 'optional_host_permissions', 'declarative_net_request', 'oauth2', 'key', 'update_url'];
let failed = false;
for (const target of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome-mv3', 'edge-mv3']) {
  const path = `.output/${target}/manifest.json`;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const problems = [];
  const same = (a = [], b = []) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (!same(manifest.permissions, expected.permissions)) problems.push(`permissions ${JSON.stringify(manifest.permissions)}`);
  if (!same(manifest.host_permissions, expected.host_permissions)) problems.push(`host_permissions ${JSON.stringify(manifest.host_permissions)}`);
  for (const script of manifest.content_scripts ?? []) {
    if (!same(script.matches, expected.contentMatches)) problems.push(`content_scripts.matches ${JSON.stringify(script.matches)}`);
    if (script.all_frames) problems.push('content scripts must stay top-frame only');
    if (script.world && script.world !== 'ISOLATED') problems.push(`content script world ${script.world}`);
  }
  for (const key of forbiddenKeys) if (key in manifest) problems.push(`unexpected key ${key}`);
  if (manifest.version !== JSON.parse(readFileSync('package.json', 'utf8')).version) problems.push('version differs from package.json');
  console.log(`${path}: ${problems.length ? 'FAIL\n  - ' + problems.join('\n  - ') : 'OK'}`);
  failed ||= problems.length > 0;
}
process.exitCode = failed ? 1 : 0;
