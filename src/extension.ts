import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ChatMessage, LocalModel, ModelProvider } from './providers/modelProvider';
import { OllamaProvider } from './providers/ollamaProvider';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'chat'; model: string; prompt: string; includeContext: boolean };

export function activate(context: vscode.ExtensionContext): void {
  const provider = createProvider();
  const viewProvider = new LocalForgeViewProvider(provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('localforge.chatView', viewProvider),
    vscode.commands.registerCommand('localforge.refreshModels', () => viewProvider.refresh())
  );
}

function createProvider(): ModelProvider {
  const baseUrl = vscode.workspace.getConfiguration('localforge.ollama').get<string>('baseUrl', 'http://127.0.0.1:11434');
  return new OllamaProvider(baseUrl.replace(/\/$/, ''));
}

class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private readonly conversations = new Map<string, ChatMessage[]>();
  private busy = false;

  constructor(private readonly provider: ModelProvider) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = getHtml();
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === 'ready' || message.type === 'refresh') void this.refresh();
      if (message.type === 'chat') void this.chat(message);
    });
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    this.post({ type: 'status', state: 'checking', message: 'Looking for Ollama…' });
    try {
      const detected = await this.provider.detect();
      if (!detected) {
        this.models = [];
        this.post({ type: 'models', models: [] });
        this.post({ type: 'status', state: 'offline', message: 'Ollama is not responding at the configured address. Start Ollama, then refresh.' });
        return;
      }

      this.models = await this.provider.listModels();
      this.post({ type: 'models', models: this.models });
      this.post({
        type: 'status',
        state: this.models.length ? 'ready' : 'empty',
        message: this.models.length ? `Connected to Ollama · ${this.models.length} model${this.models.length === 1 ? '' : 's'} found` : 'Ollama is running, but no models are installed. Pull a model, then refresh.'
      });
    } catch (error) {
      this.post({ type: 'status', state: 'error', message: errorMessage(error) });
    }
  }

  private async chat(request: Extract<WebviewMessage, { type: 'chat' }>): Promise<void> {
    if (this.busy) return;
    const model = this.models.find((item) => item.name === request.model);
    if (!model) {
      this.post({ type: 'error', message: 'Choose an available model before sending a message.' });
      return;
    }
    const prompt = request.prompt.trim();
    if (!prompt) return;

    this.busy = true;
    const messages = this.conversations.get(model.name) ?? [];
    let userContent = prompt;
    if (request.includeContext) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.document.getText(editor.selection).trim();
        const text = selection || editor.document.getText();
        if (text) {
          const label = selection ? 'Selected code' : 'Current file';
          userContent += `\n\n${label} (${vscode.workspace.asRelativePath(editor.document.uri)}):\n\`\`\`\n${text.slice(0, 20000)}\n\`\`\``;
        }
      }
    }

    messages.push({ role: 'user', content: userContent });
    this.post({ type: 'userMessage', content: prompt });
    this.post({ type: 'assistantStart' });
    let answer = '';
    try {
      await this.provider.streamChat(model.name, messages, (token) => {
        answer += token;
        this.post({ type: 'token', content: token });
      });
      messages.push({ role: 'assistant', content: answer });
      this.conversations.set(model.name, messages.slice(-40));
      this.post({ type: 'assistantDone' });
    } catch (error) {
      messages.pop();
      this.post({ type: 'error', message: errorMessage(error) });
      this.post({ type: 'assistantDone' });
    } finally {
      this.busy = false;
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getHtml(): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root { color-scheme: light dark; }
    body { padding: 12px; color: var(--vscode-foreground); font: 13px var(--vscode-font-family); }
    .row { display: flex; gap: 6px; align-items: center; }
    select, textarea, button { color: inherit; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; padding: 7px; font: inherit; }
    select { flex: 1; min-width: 0; }
    button { cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    #status { margin: 10px 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
    #status[data-state="offline"], #status[data-state="error"] { color: var(--vscode-errorForeground); }
    #messages { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
    .message { padding: 9px; border-radius: 6px; background: var(--vscode-editor-inactiveSelectionBackground); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .message.user { background: var(--vscode-textBlockQuote-background); }
    .error { color: var(--vscode-errorForeground); }
    textarea { box-sizing: border-box; width: 100%; min-height: 74px; resize: vertical; margin: 8px 0; }
    label { display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); margin: 5px 0 9px; }
    #send { width: 100%; }
    #send:disabled { opacity: .6; cursor: default; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="row"><select id="model" aria-label="Ollama model"><option value="">Discovering models…</option></select><button id="refresh" title="Refresh models" aria-label="Refresh models">↻</button></div>
  <div id="status" role="status">Connecting to Ollama…</div>
  <div id="messages" aria-live="polite"></div>
  <label><input id="context" type="checkbox" checked> Include selection or current file</label>
  <textarea id="prompt" placeholder="Ask your local model…" aria-label="Message"></textarea>
  <button id="send">Send</button>
  <div class="hint">Enter to send · Shift+Enter for a new line</div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const modelSelect = document.getElementById('model');
    const status = document.getElementById('status');
    const messages = document.getElementById('messages');
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    let assistant;
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    send.addEventListener('click', submit);
    prompt.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } });
    function submit() {
      if (!prompt.value.trim() || !modelSelect.value || send.disabled) return;
      vscode.postMessage({ type: 'chat', model: modelSelect.value, prompt: prompt.value, includeContext: document.getElementById('context').checked });
      prompt.value = '';
    }
    function addMessage(content, role) {
      const item = document.createElement('div'); item.className = 'message ' + role; item.textContent = content; messages.appendChild(item); return item;
    }
    window.addEventListener('message', event => {
      const data = event.data;
      if (data.type === 'status') { status.textContent = data.message; status.dataset.state = data.state; }
      if (data.type === 'models') {
        const previous = modelSelect.value; modelSelect.replaceChildren();
        if (!data.models.length) { const option = document.createElement('option'); option.value = ''; option.textContent = 'No models found'; modelSelect.appendChild(option); }
        for (const model of data.models) { const option = document.createElement('option'); option.value = model.name; option.textContent = model.name; modelSelect.appendChild(option); }
        if (data.models.some(model => model.name === previous)) modelSelect.value = previous;
      }
      if (data.type === 'userMessage') addMessage(data.content, 'user');
      if (data.type === 'assistantStart') { assistant = addMessage('', 'assistant'); send.disabled = true; }
      if (data.type === 'token' && assistant) assistant.textContent += data.content;
      if (data.type === 'assistantDone') { send.disabled = false; assistant = undefined; }
      if (data.type === 'error') addMessage(data.message, 'error');
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}

export function deactivate(): void {}
