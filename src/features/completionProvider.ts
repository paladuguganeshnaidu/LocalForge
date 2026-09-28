import * as vscode from 'vscode';
import { ChatMessage, ModelProvider } from '../providers/modelProvider';

export class LocalForgeCompletionProvider implements vscode.InlineCompletionItemProvider {
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
    if (!this.isEnabled() || !model || !vscode.workspace.isTrusted || cancellationToken.isCancellationRequested) return;

    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (!linePrefix.trim() || linePrefix.trim().length < 2) return;
    const prefixStart = Math.max(0, document.offsetAt(position) - 2500);
    const suffixEnd = Math.min(document.getText().length, document.offsetAt(position) + 1000);
    const before = document.getText().slice(prefixStart, document.offsetAt(position));
    const after = document.getText().slice(document.offsetAt(position), suffixEnd);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a code autocomplete engine. Return only the exact code to insert at the cursor. Do not add markdown fences, explanations, or repeat existing text. Keep the completion concise.' },
      { role: 'user', content: `Language: ${document.languageId}\nCode before cursor:\n${before}\n\nCode after cursor:\n${after}\n\nReturn only the insertion.` }
    ];
    const controller = new AbortController();
    const cancelSubscription = cancellationToken.onCancellationRequested(() => controller.abort());
    try {
      await delay(350, cancellationToken);
      if (cancellationToken.isCancellationRequested) return;
      let completion = '';
      await this.provider.streamChat(model, messages, (token) => {
        completion += token;
      }, controller.signal);
      completion = completion.trim().replace(/^```[^\n]*\n?|\n?```$/g, '');
      if (!completion || cancellationToken.isCancellationRequested) return;
      return [new vscode.InlineCompletionItem(completion)];
    } catch (error) {
      if (controller.signal.aborted || cancellationToken.isCancellationRequested) return;
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
