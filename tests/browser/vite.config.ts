import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  build: {
    outDir: '.test-browser', emptyOutDir: true,
    lib: { entry: resolve('tests/browser/harness.ts'), name: 'PamiHarness', formats: ['iife'], fileName: () => 'harness.js' },
  },
});
