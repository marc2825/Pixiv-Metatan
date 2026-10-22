import { createInspector } from '../src/network/inspector';
import { emptyResult } from '../src/metadata/types';

export default defineBackground(() => {
  const inspector = createInspector({
    extensionId: browser.runtime.id,
    tabUrl: async id => (await browser.tabs.get(id)).url,
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
