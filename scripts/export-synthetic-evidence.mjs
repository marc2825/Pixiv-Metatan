// Convert the ignored Playwright report (.verification/extension-report.json) into the committed,
// sanitized evidence format. Records contain only kinds, status/MIME, page numbers and hashes.
// Usage: node scripts/export-synthetic-evidence.mjs docs/evidence/mv3-synthetic-YYYY-MM-DD.json
import { readFileSync, writeFileSync } from 'node:fs';

const output = process.argv[2];
if (!output) { console.error('usage: export-synthetic-evidence.mjs <output.json>'); process.exit(2); }
const report = JSON.parse(readFileSync('.verification/extension-report.json', 'utf8'));
const tests = [];
const walk = suite => {
  for (const spec of suite.specs ?? []) for (const test of spec.tests) for (const result of test.results) {
    const attachment = result.attachments.find(item => item.name === 'sanitized-mv3-evidence');
    const evidence = attachment?.body ? JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) : {};
    tests.push({ title: spec.title, result: result.status === 'passed' ? 'PASS' : 'FAIL', durationMs: result.duration, ...evidence });
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites) walk(suite);
const passed = tests.filter(test => test.result === 'PASS').length;
writeFileSync(output, JSON.stringify({
  schemaVersion: 1, mode: 'synthetic-mv3', livePixivAccess: false, startedAt: report.stats.startTime,
  summary: { passed, failed: tests.length - passed }, tests,
}, null, 2) + '\n');
console.log(`${output}: ${passed}/${tests.length} PASS`);
