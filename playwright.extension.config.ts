import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/extension', testMatch: '**/*.spec.ts', workers: 1, timeout: 30_000,
  outputDir: '.verification/extension',
  reporter: [['list'], ['json', { outputFile: '.verification/extension-report.json' }]],
});
