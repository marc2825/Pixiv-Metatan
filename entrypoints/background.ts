import { createInspector } from '../src/network/inspector';
import { installRefererRule } from '../src/network/referer-rule';
import { emptyResult } from '../src/metadata/types';

export default defineBackground(() => {
  // Referer for this extension's own original-image requests only (see referer-rule.ts, issue #9).
  // A failure is not fatal: the fetch then runs without it and pximg's 403 is explained to the user.
  const refererRule = installRefererRule(browser.declarativeNetRequest, browser.runtime.id).catch(() => {});
  const inspector = createInspector({
    extensionId: browser.runtime.id,
    tabUrl: async id => (await browser.tabs.get(id)).url,
    beforeFetch: () => refererRule,
  });
  // Chrome <148 requires literal true + sendResponse for asynchronous replies.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const pending = inspector.handle(message, sender);
    if (!pending) return;
    void pending.then(sendResponse, () => sendResponse(emptyResult('access-denied', ['検査に失敗しました。ローカルファイルを選択してください。'])));
    return true;
  });
  browser.tabs.onUpdated.addListener((id, change) => {
    if (change.url) inspector.onNavigation(id, change.url);
    else if (change.status === 'loading') inspector.onNavigation(id);
  });
  browser.tabs.onRemoved.addListener(id => inspector.onNavigation(id));
});
