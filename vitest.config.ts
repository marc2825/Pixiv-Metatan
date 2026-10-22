import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'], environment: 'node',
    environmentOptions: { jsdom: { url: 'https://www.pixiv.net/artworks/123' } },
  },
});
