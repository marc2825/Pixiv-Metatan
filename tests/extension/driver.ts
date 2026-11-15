import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/** DevTools-only access to the production closed root. No application code changes. */
export class InspectorDriver {
  private readonly page: Page;
  private readonly cdp: CDPSession;
  private constructor(page: Page, cdp: CDPSession) { this.page = page; this.cdp = cdp; }
  static async create(context: BrowserContext, page: Page): Promise<InspectorDriver> {
    await page.waitForSelector('#pami-extension-root', { state: 'attached', timeout: 10_000 });
    return new InspectorDriver(page, await context.newCDPSession(page));
  }
  private async root(): Promise<number> {
    const { root } = await this.cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#pami-extension-root' });
    const { node } = await this.cdp.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
    const shadow = node.shadowRoots?.[0];
    if (!shadow || shadow.shadowRootType !== 'closed') throw new Error('production-closed-root-missing');
    return shadow.nodeId;
  }
  async node(selector: string): Promise<number> {
    const { nodeId } = await this.cdp.send('DOM.querySelector', { nodeId: await this.root(), selector });
    if (!nodeId) throw new Error(`extension-control-missing: ${selector}`);
    return nodeId;
  }
  private async call<T>(nodeId: number, declaration: string, args: unknown[] = []): Promise<T> {
    const { object } = await this.cdp.send('DOM.resolveNode', { nodeId });
    if (!object.objectId) throw new Error('extension-control-unresolved');
    try {
      const result = await this.cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId, functionDeclaration: declaration,
        arguments: args.map(value => ({ value })), returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error('extension-control-evaluation-failed');
      return result.result.value as T;
    } finally { await this.cdp.send('Runtime.releaseObject', { objectId: object.objectId }); }
  }
  async text(selector: string): Promise<string> {
    return this.call(await this.node(selector), 'function(){return this.textContent}');
  }
  async summary(): Promise<string> {
    return this.call(await this.node('[aria-label="検査結果"]'), 'function(){return this.firstElementChild?.textContent??""}');
  }
  async disabled(selector: string): Promise<boolean> {
    return this.call(await this.node(selector), 'function(){return this.disabled}');
  }
  async attribute(selector: string, name: string): Promise<string | null> {
    return this.call(await this.node(selector), 'function(name){return this.getAttribute(name)}', [name]);
  }
  async hidden(selector: string): Promise<boolean> {
    return this.call(await this.node(selector), 'function(){return this.hidden}');
  }
  async click(selector: string): Promise<void> {
    const nodeId = await this.node(selector);
    await this.cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
    const { model } = await this.cdp.send('DOM.getBoxModel', { nodeId });
    const q = model.border;
    await this.page.mouse.click((q[0]! + q[4]!) / 2, (q[1]! + q[5]!) / 2);
  }
  async select(page: number): Promise<void> {
    await this.call(await this.node('select'), 'function(value){this.value=String(value);this.dispatchEvent(new Event("change",{bubbles:true}))}', [page]);
  }
  async options(): Promise<string[]> {
    return this.call(await this.node('select'), 'function(){return Array.from(this.options,o=>o.textContent)}');
  }
  async localFile(path: string): Promise<void> {
    const chooser = this.page.waitForEvent('filechooser');
    await this.click('.buttons > button:nth-child(2)');
    await (await chooser).setFiles(path);
  }
  async files(payload: { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    const chooser = this.page.waitForEvent('filechooser');
    await this.click('.buttons > button:nth-child(2)');
    await (await chooser).setFiles(payload);
  }
}
export const ui = {
  toggle: '.toggle', scan: '.buttons > button:nth-child(1)', file: '.buttons > button:nth-child(2)',
  cancel: '.buttons > button:nth-child(3)', refresh: '.buttons > button:nth-child(4)', close: '.buttons > button:nth-child(5)',
  status: '[role="status"]', result: '[aria-label="検査結果"]',
};
