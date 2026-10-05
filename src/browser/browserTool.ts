import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ModelToolDefinition } from '../providers/modelProvider';
import { findBrowserExecutable, RenderedBrowser } from './renderedBrowser';

const execAsync = promisify(exec);

export const BROWSER_TOOL_DEFINITION: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_action',
    description: 'Verify loopback web apps. render opens a real isolated Chrome/Edge page; inspect reports DOM, forms, links, viewport, browser console and network failures; click/fill interact; viewport tests responsive sizes; close ends the session. navigate/read only fetch HTML and do NOT verify JavaScript or rendering. Non-loopback resources and WebSockets are blocked; use local assets and a production preview for testing.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'navigate', 'read', 'render', 'inspect', 'click', 'fill', 'viewport', 'close'],
          description: 'The browser action to perform'
        },
        selector: { type: 'string', description: 'Exact unique CSS selector for click/fill, taken from the page inspection.' },
        value: { type: 'string', description: 'Text entered by fill.' },
        width: { type: 'integer', minimum: 320, maximum: 2560, description: 'Optional for render, required for viewport; inspect never resizes. Provide height too.' },
        height: { type: 'integer', minimum: 240, maximum: 1600, description: 'Optional for render, required for viewport; always provide together with width.' },
        url: {
          type: 'string',
          description: 'Actual running localhost URL; required for render/open/navigate. Use the server process result, never an assumed port.'
        }
      },
      required: ['action'],
      additionalProperties: false
    }
  }
};

export interface BrowserActionResult {
  action: string;
  url?: string;
  success: boolean;
  pageTitle?: string;
  textSnippet?: string;
  consoleErrors?: string[];
  error?: string;
}

export class BrowserTool {
  private readonly rendered = new RenderedBrowser();
  private activeUrl?: string;
  private consoleErrors: string[] = [];
  private available?: boolean;

  public async isAvailable(): Promise<boolean> {
    if (this.available !== undefined) return this.available;
    if (await findBrowserExecutable()) { this.available = true; return true; }
    try {
      // Check for Chrome or Edge executable locally
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'where msedge || where chrome',
          { timeout: 3000 }
        );
        this.available = Boolean(stdout.trim());
      } else {
        const { stdout } = await execAsync(
          'which google-chrome || which chromium || which msedge',
          { timeout: 3000 }
        );
        this.available = Boolean(stdout.trim());
      }
    } catch {
      this.available = false;
    }
    return this.available;
  }

  public async open(url: string, signal?: AbortSignal): Promise<BrowserActionResult> {
    signal?.throwIfAborted();
    const isAvail = await this.isAvailable();
    signal?.throwIfAborted();
    if (!isAvail) {
      return {
        action: 'open',
        url,
        success: false,
        error: 'No local browser executable (Chrome/Edge) detected.'
      };
    }

    return this.navigate(url, signal);
  }

  public async navigate(url: string, signal?: AbortSignal): Promise<BrowserActionResult> {
    signal?.throwIfAborted();
    const safeUrl = validateLocalBrowserUrl(url);
    this.activeUrl = safeUrl;
    this.consoleErrors = [];
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const response = await fetch(safeUrl, {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'User-Agent': 'LOMVREN-LocalBrowser/0.2.5' }
      });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 1024 * 1024) throw new Error('Local page response exceeds the 1 MiB inspection limit.');
      const html = await readBoundedResponse(response, 1024 * 1024);
      controller.signal.throwIfAborted();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = titleMatch ? titleMatch[1].trim() : `Web page at ${url}`;
      const textSnippet = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);

      if (!response.ok) {
        this.consoleErrors.push(`HTTP ${response.status} ${response.statusText}`);
      }

      return {
        action: 'navigate',
        url: safeUrl,
        success: response.ok,
        pageTitle,
        textSnippet,
        consoleErrors: [...this.consoleErrors],
        error: response.ok ? undefined : `HTTP error ${response.status}: ${response.statusText}`
      };
    } catch (err: any) {
      this.activeUrl = undefined;
      const errorMsg = signal?.aborted ? 'Page inspection cancelled.' : err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Connection failed');
      this.consoleErrors.push(errorMsg);
      return {
        action: 'navigate',
        url,
        success: false,
        error: `Could not inspect local page ${safeUrl}: ${errorMsg}`,
        consoleErrors: [...this.consoleErrors]
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  public async readPage(signal?: AbortSignal): Promise<BrowserActionResult> {
    signal?.throwIfAborted();
    if (!this.activeUrl) {
      return { action: 'read', success: false, error: 'No active browser page open.' };
    }
    return this.navigate(this.activeUrl, signal);
  }

  public getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  public async execute(args: { action: string; url?: string; selector?: string; value?: string; width?: number; height?: number }, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted();
    if (['render', 'inspect', 'click', 'fill', 'viewport', 'close'].includes(args.action)) return this.rendered.execute(args as unknown as Record<string, unknown>, signal);
    if (args.action === 'open') {
      return this.open(args.url || 'http://localhost:3000', signal);
    }
    if (args.action === 'navigate') {
      return this.navigate(args.url || 'http://localhost:3000', signal);
    }
    if (args.action === 'read') {
      return this.readPage(signal);
    }
    return {
      action: args.action,
      success: false,
      error: `Unknown browser action "${args.action}".`
    };
  }

  public async dispose(): Promise<void> { await this.rendered.close(); }
}

export function validateLocalBrowserUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Browser inspection accepts only an absolute localhost HTTP(S) URL.');
  }
  const host = url.hostname.toLowerCase();
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password ||
    !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
  ) {
    throw new Error('Browser inspection is restricted to localhost HTTP(S) URLs; remote and private-network URLs are not allowed.');
  }
  return url.toString();
}

async function readBoundedResponse(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Local page response exceeds the 1 MiB inspection limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
