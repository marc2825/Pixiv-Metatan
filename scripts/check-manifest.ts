// Fails if a built manifest requests more than the documented minimum (see SECURITY.md).
// Usage: node --experimental-strip-types scripts/check-manifest.ts [chrome-mv3 edge-mv3 ...]
import { readFileSync } from 'node:fs';
import { manifestProblems } from './manifest-policy.ts';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
let failed = false;
for (const target of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome-mv3', 'edge-mv3']) {
  const path = `.output/${target}/manifest.json`;
  const problems = manifestProblems(JSON.parse(readFileSync(path, 'utf8')), version);
  console.log(`${path}: ${problems.length ? 'FAIL\n  - ' + problems.join('\n  - ') : 'OK'}`);
  failed ||= problems.length > 0;
}
process.exitCode = failed ? 1 : 0;
