import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'pixiv AI Metadata Inspector',
    description: 'Hover previews for pixiv thumbnails and click-to-inspect AI generation metadata, processed locally.',
    minimum_chrome_version: '120',
    // Toolbar icon opens the standalone local inspector page (no popup, no extra permission; issue #15).
    action: { default_title: 'ローカル画像のメタデータを検査' },
    // Only to set the pixiv Referer on this extension's own original fetch (session rule, issue #9).
    permissions: ['declarativeNetRequestWithHostAccess'],
    host_permissions: [
      'https://www.pixiv.net/*',
      'https://i.pximg.net/*',
    ],
  },
});
