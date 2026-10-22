import { mountInspector } from '../src/ui/app';
import type { InspectionResult } from '../src/metadata/types';

export default defineContentScript({
  matches: ['https://www.pixiv.net/*'],
  main(ctx) {
    const destroy = mountInspector({ send: message => browser.runtime.sendMessage(message) as Promise<InspectionResult> });
    ctx.onInvalidated(destroy);
  },
});
