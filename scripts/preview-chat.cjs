const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
const configuration = { get: (_key, fallback) => fallback };
const vscode = {
  Uri: { joinPath: (_root, ...segments) => '/' + segments.join('/') },
  workspace: { getConfiguration: () => configuration },
  window: {},
  EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} }
};
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest); };
const { LocalForgeViewProvider } = require('../dist/ui/chatView');
Module._load = originalLoad;
const state = { get: (_key, fallback) => fallback, update: async () => {} };
const provider = new LocalForgeViewProvider({ listModels: async () => [] }, { extensionUri: {}, workspaceState: state, globalState: state, subscriptions: [] });
let html = '';
provider.resolveWebviewView({
  webview: { options: {}, set html(value) { html = value; }, cspSource: 'http://127.0.0.1', asWebviewUri: (uri) => uri, onDidReceiveMessage: () => ({ dispose() {} }), postMessage: async () => true },
  onDidChangeVisibility: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), visible: true
});
const nonce = html.match(/<script nonce="([^"]+)"/)[1];
const summary = '## Project summary\nA responsive portfolio with a small, understandable structure.\n\n### Architecture\n- **Entry point:** `index.html`\n- **Styles:** `styles.css`\n- **Interactions:** `app.js`\n\n### Verification\n1. Read the project files.\n2. Run the configured tests.\n\n```text\n3 tests passed · exit 0\n```\n\n### Next step\nReview the changes before deployment.';
const bootstrap = `<script nonce="${nonce}">
window.acquireVsCodeApi = () => ({ postMessage: message => {
  if (message.type !== 'ready') return;
  const emit = data => window.dispatchEvent(new MessageEvent('message', { data }));
  emit({ type: 'models', models: [{ id: 'ollama:qwen', name: 'qwen2.5-coder:1.5b', source: 'local' }], selectedModel: 'ollama:qwen' });
  emit({ type: 'userMessage', content: 'Read the project and give me a clear summary.' });
  emit({ type: 'activity', activity: { id: 'read-fixture', category: 'Reading', title: 'Read package.json', status: 'success', durationMs: 42, toolName: 'read_file', inputSummary: 'path: package.json', outputSummary: 'Entry point and test scripts inspected.' } });
  emit({ type: 'chunk', content: 'I have inspected the entry points. I will check the tests next.' });
  emit({ type: 'status', state: 'running', message: 'Running: npm test' });
  emit({ type: 'activity', activity: { id: 'command-fixture', category: 'Running', title: 'Running: npm test', status: 'running', toolName: 'run_command', inputSummary: 'command: npm test' } });
  setTimeout(() => {
    emit({ type: 'activity', activity: { id: 'command-fixture', category: 'Running', title: 'Ran: npm test · exit 0', status: 'success', durationMs: 1800, toolName: 'run_command', inputSummary: 'command: npm test', outputSummary: ${JSON.stringify('3 tests passed\nExit code: 0')} } });
    emit({ type: 'done', fullResponse: ${JSON.stringify(summary)} });
    emit({ type: 'status', state: 'ready', message: 'Ready' });
  }, 2000);
} });
</script>`;
html = html.replace('http://127.0.0.1', 'http://127.0.0.1:*').replace('<body>', '<body>' + bootstrap);
const server = http.createServer((request, response) => {
  if (request.url === '/media/lomvren-icon.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    return response.end(fs.readFileSync(path.join(__dirname, '..', 'media', 'lomvren-icon.png')));
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(html);
});
server.listen(0, '127.0.0.1', () => console.log('CHAT_UI_FIXTURE_URL=http://127.0.0.1:' + server.address().port));
const timeout = setTimeout(() => { server.closeAllConnections(); server.close(); }, 10 * 60 * 1000);
process.on('SIGINT', () => { clearTimeout(timeout); server.closeAllConnections(); server.close(); });
