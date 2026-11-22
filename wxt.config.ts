import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Pixiv-Metatan',
    description: 'pixivのサムネイルをプレビューし、画像に埋め込まれたAI生成情報を端末内で読み取る非公式の拡張機能です。',
    minimum_chrome_version: '120',
    // Toolbar icon opens the standalone local inspector page (no popup, no extra permission; issue #15).
    action: { default_title: 'Pixiv-Metatan: ローカル画像のメタデータを検査' },
    // Only to set the pixiv Referer on this extension's own original fetch (session rule, issue #9).
    permissions: ['declarativeNetRequestWithHostAccess'],
    host_permissions: [
      'https://www.pixiv.net/*',
      'https://i.pximg.net/*',
    ],
  },
});
