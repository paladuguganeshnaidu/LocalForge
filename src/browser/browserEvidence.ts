export interface AccessibilityNode {
  role: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  children?: AccessibilityNode[];
}

export interface BrowserConsoleMessage {
  type: 'log' | 'info' | 'warn' | 'error';
  text: string;
  timestamp: number;
}

export interface BrowserEvidenceSnapshot {
  url: string;
  pageTitle: string;
  timestamp: number;
  statusCode: number;
  consoleMessages: BrowserConsoleMessage[];
  hasConsoleErrors: boolean;
  interactiveElementsCount: number;
  accessibilityRoot?: AccessibilityNode;
  passed: boolean;
}

export class BrowserEvidenceCollector {
  private readonly consoleMessages: BrowserConsoleMessage[] = [];

  public recordConsoleMessage(type: BrowserConsoleMessage['type'], text: string): void {
    this.consoleMessages.push({
      type,
      text,
      timestamp: Date.now()
    });
  }

  public createSnapshot(
    url: string,
    pageTitle: string,
    statusCode: number,
    interactiveElementsCount: number,
    accessibilityRoot?: AccessibilityNode
  ): BrowserEvidenceSnapshot {
    const hasConsoleErrors = this.consoleMessages.some((m) => m.type === 'error');
    const passed = statusCode >= 200 && statusCode < 400 && !hasConsoleErrors;

    return {
      url,
      pageTitle,
      timestamp: Date.now(),
      statusCode,
      consoleMessages: [...this.consoleMessages],
      hasConsoleErrors,
      interactiveElementsCount,
      accessibilityRoot,
      passed
    };
  }

  public clear(): void {
    this.consoleMessages.length = 0;
  }
}
