import { afterEach, expect, it, vi } from 'vitest';
import { originalUrl, png } from './fixtures';
import type { InspectionResult } from '../src/metadata/types';
import type { Sender } from '../src/network/inspector';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('wires the MV3 worker with Chrome-compatible asynchronous sendResponse and navigation cancellation', async () => {
  const addListener = vi.fn(), updated = vi.fn(), removed = vi.fn();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop', updateSessionRules = vi.fn().mockResolvedValue(undefined);
  const actionClicked = vi.fn(), createTab = vi.fn().mockResolvedValue({}), getURL = vi.fn((path: string) => `chrome-extension://${extensionId}${path}`);
  vi.stubGlobal('defineBackground', (main: () => void) => main());
  vi.stubGlobal('browser', {
    runtime: { id: extensionId, onMessage: { addListener }, getURL },
    action: { onClicked: { addListener: actionClicked } },
    declarativeNetRequest: { updateSessionRules },
    tabs: { get: vi.fn().mockResolvedValue({ url: 'https://www.pixiv.net/artworks/123' }), create: createTab, onUpdated: { addListener: updated }, onRemoved: { addListener: removed } },
  });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(png(), { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  await import('../entrypoints/background');
  expect(addListener).toHaveBeenCalledOnce(); expect(updated).toHaveBeenCalledOnce(); expect(removed).toHaveBeenCalledOnce();
  // Toolbar icon opens the standalone local inspector page in a new tab (issue #15).
  expect(createTab).not.toHaveBeenCalled(); actionClicked.mock.calls[0]![0]();
  expect(createTab).toHaveBeenCalledExactlyOnceWith({ url: `chrome-extension://${extensionId}/inspector.html` });
  const listener = addListener.mock.calls[0]![0] as (message: unknown, sender: Sender, response: (value: InspectionResult) => void) => true | undefined;
  expect(updateSessionRules).toHaveBeenCalledExactlyOnceWith({ removeRuleIds: [1], addRules: [expect.objectContaining({ condition: expect.objectContaining({ initiatorDomains: [extensionId], tabIds: [-1] }) })] });
  const sender = { id: extensionId, frameId: 0, url: 'https://www.pixiv.net/artworks/123', tab: { id: 7 } };
  const sendResponse = vi.fn();
  expect(listener({ type: 'unrelated' }, sender, sendResponse)).toBeUndefined(); expect(sendResponse).not.toHaveBeenCalled();
  expect(listener({ type: 'INSPECT_PIXIV_IMAGE', artworkId: '123', page: 0, requestId: 'request-1', url: originalUrl() }, sender, sendResponse)).toBe(true);
  await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ status: 'no-metadata', format: 'png' })));
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
  const cancelled = vi.fn();
  listener({ type: 'INSPECT_PIXIV_IMAGE', artworkId: '123', page: 0, requestId: 'request-2', url: originalUrl() }, sender, cancelled);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  updated.mock.calls[0]![0](7, { url: 'https://www.pixiv.net/artworks/456' });
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' })));
});
