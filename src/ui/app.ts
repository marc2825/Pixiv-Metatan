import type { InspectionResult } from '../metadata/types';
import { Cooldown } from '../network/failures';
import type { CancelRequest, InspectRequest } from '../network/inspector';
import { artworkIdFromUrl, getArtworkPages } from '../pixiv/artworks';
import { createPageStore } from '../pixiv/page-store';
import { icon } from './icons';
import { mountHoverPreview } from './preview';
import { STYLES } from './styles';

export interface AppDependencies {
  send: (message: InspectRequest | CancelRequest) => Promise<InspectionResult>;
  pages?: typeof getArtworkPages;
}

/**
 * One closed shadow root for everything the extension shows inside pixiv: the hover viewer and,
 * on artwork pages, a button that opens the same viewer for the artwork itself.
 */
export function mountInspector(deps: AppDependencies): () => void {
  if (document.getElementById('metatan-root')) return () => {};
  const pageStore = createPageStore(deps.pages ?? getArtworkPages);
  const cooldown = new Cooldown();
  const host = document.createElement('div'); host.id = 'metatan-root';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style'); style.textContent = STYLES;
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'toggle';
  const label = document.createElement('span'); label.textContent = '生成情報';
  toggle.append(icon('search'), label);
  toggle.setAttribute('aria-label', 'この作品の生成情報'); toggle.setAttribute('aria-controls', 'metatan-preview'); toggle.setAttribute('aria-expanded', 'false');
  shadow.append(style, toggle);
  document.documentElement.append(host);

  let artworkId = artworkIdFromUrl(location.href), disposed = false;
  const viewer = mountHoverPreview(shadow, deps, pageStore, cooldown, () => toggle.setAttribute('aria-expanded', String(viewer.artworkOpen())));
  const navigation = () => {
    artworkId = artworkIdFromUrl(location.href);
    toggle.hidden = artworkId === null;
  };
  toggle.addEventListener('click', () => {
    navigation(); if (!artworkId) return;
    if (viewer.artworkOpen()) { viewer.close(); toggle.focus(); return; }
    viewer.openArtwork(artworkId, toggle);
  });
  // One shared ticker: URL observation, cache expiry and target liveness only.
  // It never requests endpoints or images. Hidden tabs are throttled by the browser.
  const tick = () => {
    if (disposed) return;
    // Some SPA frameworks remove unknown nodes; re-attach instead of silently disappearing.
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    navigation(); viewer.tick();
  };
  const watch = window.setInterval(tick, 300);
  const navigationApi = (window as { navigation?: EventTarget }).navigation;
  navigationApi?.addEventListener('currententrychange', tick);
  document.addEventListener('visibilitychange', tick);
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) { destroy(); return; }
    // Keep the UI mount for BFCache restore, but discard results and pending work.
    viewer.close();
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true; viewer.destroy(); window.clearInterval(watch);
    navigationApi?.removeEventListener('currententrychange', tick);
    document.removeEventListener('visibilitychange', tick);
    window.removeEventListener('pagehide', pageHide); host.remove();
  };
  window.addEventListener('pagehide', pageHide);
  navigation();
  return destroy;
}
