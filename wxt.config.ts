import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'pixiv AI Metadata Inspector',
    description: 'Inspect embedded AI image generation metadata on the pixiv artwork you open.',
    version: '0.1.0',
    minimum_chrome_version: '120',
    permissions: [],
    host_permissions: [
      'https://www.pixiv.net/*',
      'https://i.pximg.net/*',
    ],
  },
});
