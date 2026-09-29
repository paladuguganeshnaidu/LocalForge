import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ModelToolDefinition } from '../providers/modelProvider';

const execAsync = promisify(exec);

export const BROWSER_TOOL_DEFINITION: ModelToolDefinition = {
  type: 'function',
  function: {
    name: 'browser_action',
    description: 'Inspect local web applications or verify local web endpoints with local browser automation.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['open', 'navigate', 'read'],
          description: 'The browser action to perform'
        },
        url: {
          type: 'string',
          description: 'The URL to open or navigate to (e.g., http://localhost:3000)'
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
  private activeUrl?: string;
  private consoleErrors: string[] = [];
  private available?: boolean;

  public async isAvailable(): Promise<boolean> {
    if (this.available !== undefined) return this.available;
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

  public async open(url: string): Promise<BrowserActionResult> {
    const isAvail = await this.isAvailable();
    if (!isAvail) {
      return {
        action: 'open',
        url,
        success: false,
        error: 'No local browser executable (Chrome/Edge) detected.'
      };
    }

    return this.navigate(url);
  }

  public async navigate(url: string): Promise<BrowserActionResult> {
    this.activeUrl = url;
    this.consoleErrors = [];

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LocalForge-Browser/0.1.7' }
      });
      clearTimeout(timeout);

      const html = await response.text();
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
        url,
        success: response.ok,
        pageTitle,
        textSnippet,
        consoleErrors: [...this.consoleErrors],
        error: response.ok ? undefined : `HTTP error ${response.status}: ${response.statusText}`
      };
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Connection timed out' : (err.message || 'Connection failed');
      this.consoleErrors.push(errorMsg);
      return {
        action: 'navigate',
        url,
        success: false,
        error: `Could not reach ${url}: ${errorMsg}`,
        consoleErrors: [...this.consoleErrors]
      };
    }
  }

  public async readPage(): Promise<BrowserActionResult> {
    if (!this.activeUrl) {
      return { action: 'read', success: false, error: 'No active browser page open.' };
    }
    return this.navigate(this.activeUrl);
  }

  public getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  public async execute(args: { action: string; url?: string }): Promise<BrowserActionResult> {
    if (args.action === 'open') {
      return this.open(args.url || 'http://localhost:3000');
    }
    if (args.action === 'navigate') {
      return this.navigate(args.url || 'http://localhost:3000');
    }
    if (args.action === 'read') {
      return this.readPage();
    }
    return {
      action: args.action,
      success: false,
      error: `Unknown browser action "${args.action}".`
    };
  }
}
