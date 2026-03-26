import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { browserStatePath, defaultScreenshotPath } from '../shared/paths.js';
import type {
  ActionResult,
  BrowserDoctorCheck,
  BrowserDoctorResult,
  BrowserSummary,
  LoadAllDetails,
  LocatorSpec,
  ManagedBrowserLaunchOptions,
  NetworkRequestSummary,
  NetworkSummary,
  PageSummary,
  SnapshotResult,
  WaitForOptions,
} from '../shared/types.js';
import { BridgeError, ensure } from '../shared/errors.js';
import type { BrowserSessionAdapter } from './base.js';
import { normalizeLocator } from '../snapshot/locator.js';
import { buildSnapshotTree, diffSnapshotTrees, snapshotExpression } from '../snapshot/semantic.js';
import { type BrowserStateRecord, type PersistedAliasRecord, type PersistedPageRecord, writeBrowserState } from '../shared/state.js';

interface ManagedPageState {
  page: Page;
  id: string;
}

interface ManagedPageNetworkState {
  requests: Map<string, NetworkRequestSummary>;
  inflight: Set<string>;
}

export class ManagedBrowserSession implements BrowserSessionAdapter {
  public readonly mode = 'managed' as const;

  private readonly attachedAt = new Date().toISOString();
  private readonly label: string;
  private readonly aliases = new Map<string, string>();
  private readonly statePath: string;
  private readonly pageStates = new Map<string, ManagedPageState>();
  private readonly pageByPlaywrightId = new WeakMap<Page, string>();
  private readonly networkByPage = new Map<string, ManagedPageNetworkState>();
  private readonly snapshotTracks = new Map<string, SnapshotResult['nodes']>();
  private pageCounter = 0;

  public constructor(
    public readonly id: string,
    label: string,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {
    this.label = label;
    this.statePath = browserStatePath(id);
  }

  public static async create(options: ManagedBrowserLaunchOptions): Promise<ManagedBrowserSession> {
    const browser = await chromium.launch({ headless: options.headless ?? true });
    const context = await browser.newContext();
    const session = new ManagedBrowserSession(options.browserId, options.label ?? options.browserId, browser, context);
    const page = await context.newPage();
    const pageId = session.registerPage(page);
    session.ensureNetworkTracking(pageId);
    if (options.url) {
      await page.goto(options.url);
    }
    return session;
  }

  public summary(): BrowserSummary {
    return {
      id: this.id,
      mode: this.mode,
      label: this.label,
      connected: this.browser.isConnected(),
      source: 'managed-playwright',
      attachedAt: this.attachedAt,
    };
  }

  public async listPages(): Promise<PageSummary[]> {
    this.syncPages();
    const pages = await Promise.all([...this.pageStates.values()].map(async (state) => await this.toPageSummary(state.id)));
    await this.persistState();
    return pages;
  }

  public async resolvePage(pageRef: string): Promise<PageSummary> {
    const pageId = await this.resolvePageId(pageRef);
    await this.persistState();
    return await this.toPageSummary(pageId);
  }

  public async doctor(pageRef?: string): Promise<BrowserDoctorResult> {
    this.syncPages();

    const checks: BrowserDoctorCheck[] = [
      {
        name: 'browser-connected',
        ok: this.browser.isConnected(),
        message: this.browser.isConnected() ? 'Managed Playwright browser is connected.' : 'Managed Playwright browser is disconnected.',
      },
      {
        name: 'alias-store',
        ok: true,
        message: 'Managed session metadata is persisted for diagnostics.',
        diagnostics: {
          path: this.statePath,
          aliasCount: this.aliases.size,
        },
      },
      {
        name: 'tracked-pages',
        ok: this.pageStates.size > 0,
        message: this.pageStates.size > 0 ? `Tracking ${String(this.pageStates.size)} page(s).` : 'No managed pages are currently tracked.',
      },
    ];

    let page: BrowserDoctorResult['page'];
    if (pageRef) {
      const pageId = await this.resolvePageId(pageRef);
      const state = this.requirePage(pageId);
      page = {
        ref: pageRef,
        summary: await this.toPageSummary(pageId),
        visibilityState: await state.page.evaluate(() => document.visibilityState),
        hasFocus: await state.page.evaluate(() => document.hasFocus()),
      };
      checks.push({
        name: 'page-visibility',
        ok: true,
        message: `Resolved ${pageRef} in managed mode.`,
        diagnostics: {
          targetId: page.summary.targetId,
          hasFocus: page.hasFocus,
        },
      });
    }

    await this.persistState();
    return {
      browser: this.summary(),
      aliasCount: this.aliases.size,
      trackedPageCount: this.pageStates.size,
      attachedPageCount: this.pageStates.size,
      aliasStorePath: this.statePath,
      page,
      checks,
    };
  }

  public async setAlias(pageRef: string, alias: string): Promise<PageSummary> {
    const pageId = await this.resolvePageId(pageRef);
    this.aliases.set(alias, pageId);
    await this.persistState();
    return await this.toPageSummary(pageId);
  }

  public async open(url = 'about:blank'): Promise<PageSummary> {
    const page = await this.context.newPage();
    const pageId = this.registerPage(page);
    this.ensureNetworkTracking(pageId);
    await page.goto(url);
    await this.persistState();
    return await this.toPageSummary(pageId);
  }

  public async close(pageRef: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.close();
    this.pageStates.delete(pageId);
    this.networkByPage.delete(pageId);
    await this.persistState();

    return {
      ok: true,
      page: {
        browserId: this.id,
        targetId: pageId,
        alias: this.findAlias(pageId),
        title: '',
        url: '',
        mode: this.mode,
        attached: false,
        lastSeenAt: new Date().toISOString(),
      },
      url: '',
      title: '',
      value: pageId,
    };
  }

  public async warm(pageRefs: string[]): Promise<PageSummary[]> {
    const refs = pageRefs.length ? pageRefs : (await this.listPages()).map((page) => page.targetId);
    const pages: PageSummary[] = [];
    for (const ref of refs) {
      const pageId = await this.resolvePageId(ref);
      pages.push(await this.toPageSummary(pageId));
    }
    await this.persistState();
    return pages;
  }

  public async detach(): Promise<BrowserSummary> {
    const summary = this.summary();
    await this.dispose();
    return {
      ...summary,
      connected: false,
    };
  }

  public async snapshot(pageRef: string, track?: string): Promise<SnapshotResult> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const payload = await state.page.evaluate((expression) => {
      return eval(expression) as {
        url: string;
        title: string;
        nodes: Array<{
          id: string;
          parentId: string | null;
          role: string;
          name: string;
          text: string;
          locators: string[];
          box: SnapshotResult['nodes'][number]['box'];
          visible: boolean;
          disabled: boolean;
          framePath: string[];
        }>;
      };
    }, snapshotExpression());
    const nodes = buildSnapshotTree(payload);
    const trackKey = track ? `${pageId}:${track}` : undefined;
    const previous = trackKey ? this.snapshotTracks.get(trackKey) : undefined;
    const diff = diffSnapshotTrees(previous, nodes);
    if (trackKey) {
      this.snapshotTracks.set(trackKey, nodes);
    }
    await this.persistState();
    return {
      page: await this.toPageSummary(pageId),
      url: payload.url,
      title: payload.title,
      nodes,
      ...diff,
    };
  }

  public async screenshot(pageRef: string, filePath?: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.bringToFront().catch(() => undefined);
    const outputPath = filePath ?? defaultScreenshotPath(this.id, pageId);
    await writeFile(outputPath, await state.page.screenshot({ type: 'png' }));
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return {
      ok: true,
      page: summary,
      url: summary.url,
      title: summary.title,
      value: outputPath,
      screenshotPath: outputPath,
      diagnostics: await this.pageDiagnostics(state.page),
    };
  }

  public async html(pageRef: string, locator?: LocatorSpec): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const value = locator
      ? await this.resolveLocator(state.page, locator).evaluate((element) => element.outerHTML)
      : await state.page.content();
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value };
  }

  public async evaluate<TValue = unknown>(pageRef: string, expression: string): Promise<ActionResult<TValue>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const value = await state.page.evaluate((source) => eval(source) as TValue, expression);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value };
  }

  public async click(pageRef: string, locator: LocatorSpec): Promise<ActionResult> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.bringToFront().catch(() => undefined);
    await this.resolveLocator(state.page, locator).click();
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title };
  }

  public async clickPoint(pageRef: string, x: number, y: number): Promise<ActionResult<{ x: number; y: number }>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.bringToFront().catch(() => undefined);
    await state.page.mouse.click(x, y);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return {
      ok: true,
      page: summary,
      url: summary.url,
      title: summary.title,
      value: { x, y },
      diagnostics: {
        coordinateSpace: 'css-pixels',
        ...(await this.pageDiagnostics(state.page)),
      },
    };
  }

  public async fill(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await this.resolveLocator(state.page, locator).fill(value);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value };
  }

  public async type(pageRef: string, locator: LocatorSpec, value: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await this.resolveLocator(state.page, locator).type(value);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value };
  }

  public async insertText(pageRef: string, value: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.bringToFront().catch(() => undefined);
    await state.page.keyboard.insertText(value);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value };
  }

  public async loadAll(pageRef: string, locator: LocatorSpec, intervalMs = 250): Promise<ActionResult<LoadAllDetails>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const target = this.resolveLocator(state.page, locator);
    const normalizedInterval = Math.max(50, intervalMs);
    const maxClicks = 100;
    let clicks = 0;

    await state.page.bringToFront().catch(() => undefined);

    while (clicks < maxClicks) {
      const count = await target.count();
      if (count === 0) {
        break;
      }

      const first = target.first();
      const disabled = await first.evaluate((element) => {
        return Boolean(
          element.hasAttribute('disabled')
          || element.getAttribute('aria-disabled') === 'true'
          || ('disabled' in element && (element as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled)
        );
      });
      if (disabled) {
        const summary = await this.toPageSummary(pageId);
        await this.persistState();
        return {
          ok: true,
          page: summary,
          url: summary.url,
          title: summary.title,
          value: {
            clicks,
            completed: true,
            stopReason: 'disabled',
            intervalMs: normalizedInterval,
          },
        };
      }

      await first.click();
      clicks += 1;
      await state.page.waitForTimeout(normalizedInterval);
    }

    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return {
      ok: true,
      page: summary,
      url: summary.url,
      title: summary.title,
      value: {
        clicks,
        completed: clicks < maxClicks,
        stopReason: clicks < maxClicks ? 'missing' : 'limit',
        intervalMs: normalizedInterval,
      },
      diagnostics: clicks < maxClicks ? undefined : { limit: maxClicks },
    };
  }

  public async press(pageRef: string, key: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.keyboard.press(key);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value: key };
  }

  public async hover(pageRef: string, locator: LocatorSpec): Promise<ActionResult> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await this.resolveLocator(state.page, locator).hover();
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title };
  }

  public async wait(pageRef: string, options: WaitForOptions): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const timeout = options.timeoutMs ?? 15_000;

    if (options.selector) {
      await this.resolveLocator(state.page, options.selector).waitFor({ state: options.hidden ? 'hidden' : 'visible', timeout });
    } else if (options.text) {
      await state.page.getByText(options.text).waitFor({ timeout });
    } else if (options.url) {
      await state.page.waitForURL(new RegExp(options.url), { timeout });
    } else if (options.networkIdle || options.idle) {
      await state.page.waitForLoadState('networkidle', { timeout });
    }

    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value: 'wait' };
  }

  public async networkSummary(pageRef: string): Promise<NetworkSummary> {
    const pageId = await this.resolvePageId(pageRef);
    return await this.networkSnapshot(pageId);
  }

  public async cdp<TValue = unknown>(pageRef: string, method: string, params?: Record<string, unknown>): Promise<TValue> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    const session = await this.context.newCDPSession(state.page);
    return (await session.send(method as never, (params ?? {}) as never)) as TValue;
  }

  public async goto(pageRef: string, url: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.goto(url);
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value: url };
  }

  public async reload(pageRef: string): Promise<ActionResult<string>> {
    const pageId = await this.resolvePageId(pageRef);
    const state = this.requirePage(pageId);
    await state.page.reload();
    const summary = await this.toPageSummary(pageId);
    await this.persistState();
    return { ok: true, page: summary, url: summary.url, title: summary.title, value: summary.url };
  }

  public async dispose(): Promise<void> {
    await this.persistState().catch(() => undefined);
    await this.browser.close();
  }

  private syncPages(): void {
    for (const page of this.context.pages()) {
      if (this.pageByPlaywrightId.has(page)) {
        continue;
      }

      const id = this.registerPage(page);
      this.ensureNetworkTracking(id);
    }
  }

  private registerPage(page: Page): string {
    const id = `managed-${++this.pageCounter}`;
    this.pageStates.set(id, { id, page });
    this.pageByPlaywrightId.set(page, id);
    page.on('close', () => {
      this.pageStates.delete(id);
      this.networkByPage.delete(id);
      void this.persistState();
    });
    return id;
  }

  private ensureNetworkTracking(pageId: string): void {
    const state = this.requirePage(pageId);
    if (this.networkByPage.has(pageId)) {
      return;
    }

    const networkState: ManagedPageNetworkState = {
      requests: new Map(),
      inflight: new Set(),
    };
    this.networkByPage.set(pageId, networkState);

    state.page.on('request', (request) => {
      const id = `${Date.now()}-${Math.random()}`;
      networkState.requests.set(id, {
        id,
        url: request.url(),
        method: request.method(),
        failed: false,
        resourceType: request.resourceType(),
        startedAt: new Date().toISOString(),
      });
      networkState.inflight.add(id);
    });

    state.page.on('response', (response) => {
      const requestId = [...networkState.requests.values()].find((request) => request.url === response.url() && request.finishedAt === undefined)?.id;
      if (!requestId) {
        return;
      }
      const existing = networkState.requests.get(requestId);
      if (existing) {
        existing.status = response.status();
        existing.finishedAt = new Date().toISOString();
      }
      networkState.inflight.delete(requestId);
    });

    state.page.on('requestfailed', (request) => {
      const requestId = [...networkState.requests.values()].find((entry) => entry.url === request.url() && entry.finishedAt === undefined)?.id;
      if (!requestId) {
        return;
      }
      const existing = networkState.requests.get(requestId);
      if (existing) {
        existing.failed = true;
        existing.errorText = request.failure()?.errorText;
        existing.finishedAt = new Date().toISOString();
      }
      networkState.inflight.delete(requestId);
    });
  }

  private async resolvePageId(pageRef: string): Promise<string> {
    this.syncPages();

    if (this.aliases.has(pageRef)) {
      return this.aliases.get(pageRef) as string;
    }

    if (this.pageStates.has(pageRef)) {
      return pageRef;
    }

    const byPrefix = [...this.pageStates.keys()].filter((id) => id.startsWith(pageRef));
    if (byPrefix.length === 1) {
      return byPrefix[0];
    }

    const byUrl = [...this.pageStates.values()].filter((state) => state.page.url().includes(pageRef));
    if (byUrl.length === 1) {
      return byUrl[0].id;
    }

    const titles = await Promise.all(
      [...this.pageStates.values()].map(async (state) => ({ id: state.id, title: await state.page.title() })),
    );
    const byTitle = titles.filter((item) => item.title.toLowerCase().includes(pageRef.toLowerCase()));
    if (byTitle.length === 1) {
      return byTitle[0].id;
    }

    throw new BridgeError('PAGE_NOT_FOUND', `Unable to resolve page reference "${pageRef}" in browser ${this.id}.`);
  }

  private findAlias(pageId: string): string | null {
    for (const [alias, value] of this.aliases.entries()) {
      if (value === pageId) {
        return alias;
      }
    }
    return null;
  }

  private async toPageSummary(pageId: string): Promise<PageSummary> {
    const state = this.requirePage(pageId);
    return {
      browserId: this.id,
      targetId: pageId,
      alias: this.findAlias(pageId),
      title: await state.page.title(),
      url: state.page.url(),
      mode: this.mode,
      attached: true,
      lastSeenAt: new Date().toISOString(),
    };
  }

  private requirePage(pageId: string): ManagedPageState {
    const state = this.pageStates.get(pageId);
    ensure(state, 'PAGE_NOT_FOUND', `Managed page ${pageId} not found.`);
    return state;
  }

  private async networkSnapshot(pageId: string): Promise<NetworkSummary> {
    const page = await this.toPageSummary(pageId);
    const network = this.networkByPage.get(pageId);
    const requests = network ? [...network.requests.values()] : [];
    requests.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    return {
      browserId: this.id,
      page,
      inflightCount: network?.inflight.size ?? 0,
      recent: requests.slice(0, 25),
      failed: requests.filter((request) => request.failed).slice(0, 25),
    };
  }

  private async persistState(): Promise<void> {
    const state: BrowserStateRecord = {
      version: 1,
      browserId: this.id,
      mode: this.mode,
      label: this.label,
      attachedAt: this.attachedAt,
      updatedAt: new Date().toISOString(),
      managedOptions: {
        browserId: this.id,
        label: this.label,
      },
      aliases: [...this.aliases.entries()].map(([alias, pageId]): PersistedAliasRecord => {
        const page = this.pageStates.get(pageId);
        return {
          alias,
          targetId: pageId,
          title: page ? page.page.url() : '',
          url: page ? page.page.url() : '',
          lastSeenAt: new Date().toISOString(),
        };
      }),
      pages: await Promise.all(
        [...this.pageStates.values()].map(async (state): Promise<PersistedPageRecord> => ({
          targetId: state.id,
          title: await state.page.title(),
          url: state.page.url(),
          lastSeenAt: new Date().toISOString(),
        })),
      ),
    };

    await writeBrowserState(state);
  }

  private async pageDiagnostics(page: Page): Promise<Record<string, unknown>> {
    return await page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio || 1,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      scroll: {
        x: window.scrollX,
        y: window.scrollY,
      },
    }));
  }

  private resolveLocator(page: Page, locator: LocatorSpec): Locator {
    const normalized = normalizeLocator(locator);
    switch (normalized.kind) {
      case 'css':
        return page.locator(normalized.value ?? '');
      case 'text':
        return page.getByText(normalized.value ?? '').nth(normalized.nth);
      case 'label':
        return page.getByLabel(normalized.value ?? '').nth(normalized.nth);
      case 'testid':
        return page.getByTestId(normalized.value ?? '').nth(normalized.nth);
      case 'role': {
        const [roleName, name] = (normalized.value ?? '').split('|');
        return page.getByRole(roleName as never, name ? { name } : {}).nth(normalized.nth);
      }
      case 'object': {
        if (normalized.testId) {
          return page.getByTestId(normalized.testId).nth(normalized.nth);
        }
        if (normalized.label) {
          return page.getByLabel(normalized.label).nth(normalized.nth);
        }
        if (normalized.text) {
          return page.getByText(normalized.text).nth(normalized.nth);
        }
        if (normalized.role) {
          return page.getByRole(normalized.role as never, normalized.name ? { name: normalized.name } : {}).nth(normalized.nth);
        }
        throw new BridgeError('LOCATOR_UNSUPPORTED', 'Unsupported managed locator.');
      }
    }
  }
}
