import * as vscode from 'vscode';
import { ChatMessage, ModelProvider } from '../providers/modelProvider';

export class TuxNestCompletionProvider implements vscode.InlineCompletionItemProvider {
  private lastRequestId = 0;

  constructor(
    private readonly provider: ModelProvider,
    private readonly isEnabled: () => boolean,
    private readonly getModel: () => string | undefined
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    cancellationToken: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const model = this.getModel();
    if (!this.isEnabled() || !model || !vscode.workspace.isTrusted || cancellationToken.isCancellationRequested) {
      return;
    }

    const currentRequestId = ++this.lastRequestId;

    const lineText = document.lineAt(position.line).text;
    const linePrefix = lineText.slice(0, position.character);
    if (!linePrefix.trim() || linePrefix.trim().length < 2) {
      return;
    }

    // Context bounds: 2500 chars before, 1000 chars after cursor
    const currentOffset = document.offsetAt(position);
    const prefixStart = Math.max(0, currentOffset - 2500);
    const suffixEnd = Math.min(document.getText().length, currentOffset + 1000);
    const before = document.getText().slice(prefixStart, currentOffset);
    const after = document.getText().slice(currentOffset, suffixEnd);

    // Extract imports from top of document if outside window
    let topContext = '';
    if (prefixStart > 0) {
      const topLines = document.getText().slice(0, 1000).split(/\r?\n/).slice(0, 20);
      const importLines = topLines.filter((l) => /^(import|const\s+.*=\s+require|using|include|package)\b/.test(l.trim()));
      if (importLines.length > 0) {
        topContext = `Top declarations:\n${importLines.join('\n')}\n\n`;
      }
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a code autocomplete engine. Return only the exact code to insert at the cursor. Do not add markdown fences, explanations, or repeat existing text. Keep the completion concise.'
      },
      {
        role: 'user',
        content: `Language: ${document.languageId}\n${topContext}Code before cursor:\n${before}\n\nCode after cursor:\n${after}\n\nReturn only the insertion.`
      }
    ];

    const controller = new AbortController();
    const cancelSubscription = cancellationToken.onCancellationRequested(() => controller.abort());

    try {
      // Debounce 300ms
      await delay(300, cancellationToken);
      if (cancellationToken.isCancellationRequested || this.lastRequestId !== currentRequestId) {
        return;
      }

      let completion = '';
      await this.provider.streamChat(
        model,
        messages,
        (token) => {
          completion += token;
        },
        controller.signal
      );

      // Clean fences
      completion = completion.trim().replace(/^```[^\n]*\n?|\n?```$/g, '');

      // Guard against stale request
      if (!completion || cancellationToken.isCancellationRequested || this.lastRequestId !== currentRequestId) {
        return;
      }

      const item = new vscode.InlineCompletionItem(completion);
      item.range = new vscode.Range(position, position);
      return [item];
    } catch {
      return;
    } finally {
      cancelSubscription.dispose();
    }
  }
}

function delay(milliseconds: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve();
    }, milliseconds);
    const subscription = token.onCancellationRequested(() => {
      clearTimeout(timer);
      subscription.dispose();
      reject(new Error('Cancelled'));
    });
  });
}

export const LocalForgeCompletionProvider = TuxNestCompletionProvider;
export type LocalForgeCompletionProvider = TuxNestCompletionProvider;
