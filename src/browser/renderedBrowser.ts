import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';

export async function findBrowserExecutable(): Promise<string | undefined> {
  const candidates = process.platform === 'win32' ? [
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  return undefined;
}

function localUrl(input: string): string {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Rendered browser accepts only loopback HTTP(S) URLs without credentials.');
  return url.toString();
}

export class RenderedBrowser {
  private browser?: Browser;
  private page?: Page;
  private errors: string[] = [];
  private failures: string[] = [];
  private documentStatus?: number;
  private renderedUrl?: string;

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.page = undefined;
    this.renderedUrl = undefined;
    await browser?.close();
  }

  async execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const action = args.action;
    if (action !== 'viewport' && action !== 'render' && (args.width !== undefined || args.height !== undefined)) throw new Error('width and height require action viewport or render; inspect does not resize the page. Use browser_action with action viewport and both dimensions.');
    if (action === 'viewport' || args.width !== undefined || args.height !== undefined) {
      if (!Number.isInteger(args.width) || !Number.isInteger(args.height) || Number(args.width) < 320 || Number(args.width) > 2560 || Number(args.height) < 240 || Number(args.height) > 1600) throw new Error('Viewport dimensions must be integers: width 320–2560, height 240–1600. Provide both width and height.');
    }
    if (action === 'close') { await this.close(); return { success: true, action, rendered: true }; }
    const cancel = () => { void this.close(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      let beforeClickText: string | undefined;
      if (action === 'render') {
        if (typeof args.url !== 'string' || !args.url.trim()) throw new Error('render requires the actual running localhost URL. Start the server, inspect process_status, then render its URL; do not guess a port.');
        const url = localUrl(args.url);
        if (!this.page) {
          const executablePath = await findBrowserExecutable();
          if (!executablePath) throw new Error('Install Chrome or Edge before rendering local sites.');
          const { chromium } = require('playwright-core') as typeof import('playwright-core');
          this.browser = await chromium.launch({ executablePath, headless: true, timeout: 15000 });
          const context = await this.browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
          await context.route('**/*', async route => {
            try { localUrl(route.request().url()); await route.continue(); }
            catch { this.failures.push(`Blocked non-loopback request: ${route.request().url()}`); await route.abort('blockedbyclient'); }
          });
          await context.routeWebSocket('**/*', socket => { socket.close(); });
          this.page = await context.newPage();
          this.page.setDefaultTimeout(10000);
          this.page.on('console', message => { if (message.type() === 'error') this.errors.push(message.text()); });
          this.page.on('pageerror', error => this.errors.push(error.message));
          this.page.on('requestfailed', request => this.failures.push(`${request.url()}: ${request.failure()?.errorText || 'request failed'}`));
          this.page.on('response', response => { if (response.request().isNavigationRequest() && response.frame() === this.page?.mainFrame()) this.documentStatus = response.status(); if (response.status() >= 400) this.failures.push(`${response.url()}: HTTP ${response.status()}`); });
          context.on('page', page => { if (page !== this.page) void page.close(); });
        }
        this.errors = [];
        this.failures = [];
        this.documentStatus = undefined;
        this.renderedUrl = undefined;
        if (args.width !== undefined) await this.page.setViewportSize({ width: Number(args.width), height: Number(args.height) });
        const response = await this.page.goto(url, { waitUntil: 'load', timeout: 20000 });
        if (response && !response.ok()) throw new Error(`Rendered document returned HTTP ${response.status()}`);
        this.renderedUrl = localUrl(this.page.url());
      } else {
        if (!this.page || !this.renderedUrl) throw new Error('No successfully rendered page. Call browser_action render with the actual running localhost URL first; open/navigate only fetch HTML and do not create a rendered session.');
        const selector = args.selector;
        if (action === 'click' || action === 'fill') {
          if (typeof selector !== 'string' || !selector.trim() || selector.length > 1000) throw new Error('Provide a bounded CSS selector from the inspected page.');
          const locator = this.page.locator(selector);
          if (await locator.count() !== 1) throw new Error('The selector must identify exactly one element. Inspect the page and choose a specific selector.');
          if (action === 'click') { beforeClickText = await this.page.locator('body').innerText(); await locator.click(); }
          else { if (typeof args.value !== 'string' || args.value.length > 10000) throw new Error('fill requires a bounded string value.'); await locator.fill(args.value); }
        } else if (action === 'viewport') {
          await this.page.setViewportSize({ width: Number(args.width), height: Number(args.height) });
        } else if (action !== 'inspect') throw new Error('Unknown rendered browser action.');
      }
      signal?.throwIfAborted();
      const page = this.page!;
      localUrl(page.url());
      const snapshot = await page.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 8000),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(element => ({ tag: element.tagName, text: element.textContent?.trim() })),
        links: Array.from(document.querySelectorAll('a')).slice(0, 100).map(element => ({ text: element.textContent?.trim(), href: element.getAttribute('href'), brokenFragment: element.hash.length > 1 && !document.getElementById(decodeURIComponent(element.hash.slice(1))) })),
        navigationRoutes: Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map(element => (element as HTMLAnchorElement).href).filter(href => { const target = new URL(href); return target.origin === location.origin && (target.pathname !== location.pathname || target.search !== location.search); }))).slice(0, 20),
        forms: Array.from(document.querySelectorAll('input,textarea,select')).slice(0, 100).map(element => { const field = element as HTMLInputElement; return { id: field.id, name: field.name, type: field.type, valid: field.checkValidity(), message: field.validationMessage, label: field.labels?.[0]?.textContent?.trim() || field.getAttribute('aria-label') || '' }; }),
        imagesWithoutAlt: Array.from(document.images).filter(image => !image.hasAttribute('alt')).length,
        language: document.documentElement.lang,
        mainLandmarks: document.querySelectorAll('main,[role="main"]').length,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
        favicon: document.querySelector('link[rel~="icon"]')?.getAttribute('href'),
        faviconSyntaxValid: (() => {
          const href = document.querySelector('link[rel~="icon"]')?.getAttribute('href');
          if (!href?.startsWith('data:image/svg+xml')) return undefined;
          try {
            const separator = href.indexOf(',');
            if (separator === -1) return false;
            const source = href.slice(0, separator).includes(';base64') ? atob(href.slice(separator + 1)) : decodeURIComponent(href.slice(separator + 1));
            const parsedFavicon = new DOMParser().parseFromString(source, 'image/svg+xml');
            return parsedFavicon.documentElement.localName === 'svg' && parsedFavicon.getElementsByTagName('parsererror').length === 0;
          } catch { return false; }
        })()
      }));
      const accessibility = await page.locator('body').ariaSnapshot();
      return { success: true, rendered: true, action, url: page.url(), httpStatus: this.documentStatus, ...snapshot, ...(beforeClickText === undefined ? {} : { visibleTextChanged: beforeClickText.slice(0, 8000) !== snapshot.text }), accessibility: accessibility.slice(0, 10000), consoleErrors: this.errors.slice(-50), networkFailures: this.failures.slice(-50) };
    } catch (error) {
      if (signal?.aborted) { await this.close(); signal.throwIfAborted(); }
      throw error;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
}
