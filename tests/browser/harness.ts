import { mountInspector } from '../../src/ui/app';
import { createInspector, type InspectRequest, type CancelRequest } from '../../src/network/inspector';

// Test-only adapter. No extension is installed; network is intercepted by Playwright.
const messages: (InspectRequest | CancelRequest)[] = [];
Object.assign(window, { metatanTestMessages: messages });
const inspector = createInspector({ extensionId: 'synthetic-extension', tabUrl: async () => location.href });
mountInspector({ send: async message => {
  messages.push(message);
  const result = await inspector.handle(message, { id: 'synthetic-extension', frameId: 0, url: location.href, tab: { id: 1 } });
  if (!result) throw new Error('unhandled test message');
  return JSON.parse(JSON.stringify(result));
} });
