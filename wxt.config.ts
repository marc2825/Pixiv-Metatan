import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'pixiv AI Metadata Inspector',
    description: 'Inspect embedded AI image generation metadata on the pixiv artwork you open.',
    version: '0.1.0',
    manifest_version: 3,
    permissions: [],
    host_permissions: [
      'https://www.pixiv.net/*',
      'https://i.pximg.net/*',
    ],
  },
});
