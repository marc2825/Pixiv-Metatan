import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', testMatch: '**/*.spec.ts', workers: 1, timeout: 20_000,
  use: {
    browserName: 'chromium', headless: true, viewport: { width: 1100, height: 850 },
    launchOptions: process.env.METATAN_CHROME_PATH ? { executablePath: process.env.METATAN_CHROME_PATH } : {},
  },
});
