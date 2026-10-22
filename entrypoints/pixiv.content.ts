import { inspectImage } from '../src/metadata/inspect';
import { artworkIdFromUrl, getArtworkPages } from '../src/pixiv/artworks';
import { renderResult } from '../src/ui/result';
import type { InspectionResult } from '../src/metadata/types';

export default defineContentScript({
  matches: ['https://www.pixiv.net/*'],
  main() {
    const host = document.createElement('div');
    host.id = 'pami-extension-root';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .toggle {position:fixed;right:16px;bottom:20px;z-index:2147483646;background:#202b3b;color:white;border:0;border-radius:999px;padding:12px 18px;font:600 13px system-ui;cursor:pointer;box-shadow:0 3px 20px #0004}
      .panel {position:fixed;right:16px;bottom:70px;z-index:2147483646;width:min(420px,calc(100vw - 32px));max-height:75vh;overflow:auto;box-sizing:border-box;background:#fff;color:#172435;border:1px solid #dde2e9;border-radius:14px;padding:16px;font:13px/1.5 system-ui;box-shadow:0 8px 30px #0004}
      .panel[hidden],.toggle[hidden]{display:none} button,select{cursor:pointer} .buttons{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0} .buttons button{padding:7px 10px;border:1px solid #bec8d6;border-radius:8px;background:white;color:#172435}
      select{width:100%;padding:6px} pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef2f6;padding:8px;border-radius:6px;max-height:160px;overflow:auto} small{color:#526070}
    `;
    shadow.appendChild(style);
    const toggle = document.createElement('button'); toggle.className = 'toggle'; toggle.textContent = 'AI Metadata';
    const panel = document.createElement('section'); panel.className = 'panel'; panel.hidden = true;
    const title = document.createElement('strong'); title.textContent = 'pixiv AI Metadata Inspector (starter)';
    const intro = document.createElement('p'); intro.textContent = '作品を開いた状態で検査します。直接取得できない場合はPNGを手動で選択してください。';
    const select = document.createElement('select');
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const scan = document.createElement('button'); scan.textContent = '元画像を検査';
    const fileButton = document.createElement('button'); fileButton.textContent = 'ローカルファイルを検査';
    const close = document.createElement('button'); close.textContent = '閉じる';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
    const output = document.createElement('div'); output.setAttribute('aria-live', 'polite');
    buttons.append(scan, fileButton, close);
    panel.append(title, intro, select, buttons, file, output);
    shadow.append(toggle, panel);
    document.documentElement.appendChild(host);

    const updateVisibility = () => { toggle.hidden = artworkIdFromUrl(location.href) === null; if (toggle.hidden) panel.hidden = true; };
    updateVisibility();
    // pixiv uses client-side navigation. The interval checks only URL; no image scanning.
    let previousUrl = location.href;
    const watch = window.setInterval(() => {
      if (location.href !== previousUrl) { previousUrl = location.href; select.replaceChildren(); output.replaceChildren(); updateVisibility(); }
      if (!host.isConnected) window.clearInterval(watch);
    }, 1000);
    toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) void populate(); });
    close.addEventListener('click', () => { panel.hidden = true; });
    fileButton.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const selected = file.files?.[0]; if (!selected) return;
      void (async () => {
        try { output.textContent = '検査中…'; renderResult(output, inspectImage(new Uint8Array(await selected.arrayBuffer()))); }
        catch (e) { output.textContent = `解析できませんでした: ${String(e)}`; }
      })();
    });
    scan.addEventListener('click', () => void (async () => {
      const url = select.value;
      if (!url) { output.textContent = '原画像URLがありません。PNGファイルの手動読込をご利用ください。'; return; }
      output.textContent = '元画像を検査中…';
      try {
        const result = await browser.runtime.sendMessage({ type: 'INSPECT_PIXIV_IMAGE', url }) as InspectionResult;
        renderResult(output, result);
      } catch (e) { output.textContent = `検査失敗: ${String(e)}`; }
    })());

    async function populate() {
      const artworkId = artworkIdFromUrl(location.href);
      if (!artworkId) return;
      select.replaceChildren(); output.textContent = '作品の画像一覧を取得中…';
      try {
        const pages = await getArtworkPages(artworkId);
        for (const page of pages) {
          const opt = document.createElement('option'); opt.value = page.original;
          opt.textContent = `${page.page + 1}枚目（元画像）`;
          select.appendChild(opt);
        }
        output.textContent = `${pages.length}枚の画像を検出。クリックで検査します。`;
      } catch (e) {
        output.textContent = `作品情報を取得できませんでした。手動読込をご利用ください: ${String(e)}`;
      }
    }
  },
});
