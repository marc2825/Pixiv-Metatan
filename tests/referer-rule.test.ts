import { describe, expect, it, vi } from 'vitest';
import { installRefererRule, pixivRefererRule, PIXIV_REFERER, REFERER_RULE_ID } from '../src/network/referer-rule';

const ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('pixiv Referer session rule (issue #9)', () => {
  it('sets only the Referer request header to the pixiv origin', () => {
    const rule = pixivRefererRule(ID);
    expect(rule.action).toEqual({ type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: PIXIV_REFERER }] });
    expect(PIXIV_REFERER).toBe('https://www.pixiv.net/');
    expect(rule.action).not.toHaveProperty('responseHeaders');
  });
  it('is limited to this extension, no tab, GET fetches of i.pximg.net originals', () => {
    expect(pixivRefererRule(ID).condition).toEqual({
      urlFilter: '|https://i.pximg.net/img-original/', requestDomains: ['i.pximg.net'], initiatorDomains: [ID],
      tabIds: [-1], resourceTypes: ['xmlhttprequest'], requestMethods: ['get'],
    });
  });
  it.each(['', 'test-extension', 'A'.repeat(32), 'q'.repeat(32), `${ID}x`])('refuses an unexpected extension ID %j', id => {
    expect(() => pixivRefererRule(id)).toThrow('unexpected-extension-id');
  });
  it('installs idempotently as a session rule', async () => {
    const updateSessionRules = vi.fn().mockResolvedValue(undefined);
    await installRefererRule({ updateSessionRules }, ID);
    expect(updateSessionRules).toHaveBeenCalledExactlyOnceWith({ removeRuleIds: [REFERER_RULE_ID], addRules: [pixivRefererRule(ID)] });
  });
});
