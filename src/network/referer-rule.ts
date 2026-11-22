/**
 * i.pximg.net answers 403 to requests without a pixiv Referer (measured 2026-11-19/22; cookies are
 * not involved). By maintainer decision (2026-11-22, issue #9) the extension sets
 * `Referer: https://www.pixiv.net/` on its **own** original-image request, following the approach
 * of PixivBatchDownloader but deliberately narrower:
 * - only requests initiated by this extension (initiatorDomains = extension ID) that belong to no
 *   tab (tabIds = TAB_ID_NONE), i.e. the service-worker fetch after an explicit click;
 * - only GET fetches to `https://i.pximg.net/img-original/`;
 * - request header only: no Access-Control-Allow-Origin rewrite, no cookies, no other headers, and
 *   no effect on pixiv pages, other websites or other extensions.
 */
export const PIXIV_REFERER = 'https://www.pixiv.net/';
export const REFERER_RULE_ID = 1;
const TAB_ID_NONE = -1;

export interface RefererRule {
  id: number;
  priority: number;
  action: { type: 'modifyHeaders'; requestHeaders: { header: string; operation: 'set'; value: string }[] };
  condition: {
    urlFilter: string; requestDomains: string[]; initiatorDomains: string[]; tabIds: number[];
    resourceTypes: 'xmlhttprequest'[]; requestMethods: 'get'[];
  };
}

export function pixivRefererRule(extensionId: string): RefererRule {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('unexpected-extension-id');
  return {
    id: REFERER_RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: PIXIV_REFERER }] },
    condition: {
      urlFilter: '|https://i.pximg.net/img-original/',
      requestDomains: ['i.pximg.net'],
      initiatorDomains: [extensionId],
      tabIds: [TAB_ID_NONE],
      resourceTypes: ['xmlhttprequest'],
      requestMethods: ['get'],
    },
  };
}

interface SessionRulesApi {
  updateSessionRules(options: { removeRuleIds?: number[]; addRules?: RefererRule[] }): Promise<void>;
}

/** Idempotent: session rules survive service-worker restarts but not browser restarts. */
export async function installRefererRule(api: SessionRulesApi, extensionId: string): Promise<void> {
  await api.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID], addRules: [pixivRefererRule(extensionId)] });
}
