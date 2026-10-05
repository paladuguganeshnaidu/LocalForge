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
const { ModelCenterViewProvider } = require('../dist/ui/modelCenter');
Module._load = originalLoad;
const state = { get: (_key, fallback) => fallback, update: async () => {} };
const provider = new LocalForgeViewProvider({ listModels: async () => [] }, { extensionUri: {}, workspaceState: state, globalState: state, subscriptions: [] });
let html = '';
provider.resolveWebviewView({
  webview: { options: {}, set html(value) { html = value; }, cspSource: 'http://127.0.0.1', asWebviewUri: (uri) => uri, onDidReceiveMessage: () => ({ dispose() {} }), postMessage: async () => true },
  onDidChangeVisibility: () => ({ dispose() {} }), onDidDispose: () => ({ dispose() {} }), visible: true
});
const nonce = html.match(/<script nonce="([^"]+)"/)[1];
const bootstrap = `<script nonce="${nonce}">
window.__previewMessages = [];
window.acquireVsCodeApi = () => ({ postMessage: message => {
  window.__previewMessages.push(message);
  if (message.type === 'ready') {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'status', state: 'ready', message: 'UI preview only · no agent execution' } }));
  }
  if (message.type === 'chat') {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'error', message: 'This is an interface preview, not the installed extension. No model, command or file action was executed. Use LOMVREN in VS Code for real tasks.' } }));
  }
} });
</script>`;
html = html.replace('http://127.0.0.1', 'http://127.0.0.1:*').replace('<body>', '<body>' + bootstrap);
const modelHtml = new ModelCenterViewProvider({}).getHtml({ cspSource: 'http://127.0.0.1:*' });
const modelNonce = modelHtml.match(/<script nonce="([^"]+)"/)[1];
const modelPreview = modelHtml.replace('<body>', '<body>' + bootstrap.replace(nonce, modelNonce));
const server = http.createServer((request, response) => {
  if (request.url === '/media/lomvren-icon.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    return response.end(fs.readFileSync(path.join(__dirname, '..', 'media', 'lomvren-icon.png')));
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(request.url === '/models' ? modelPreview : html);
});
let listenAttempts = 0;
function listen() {
  listenAttempts += 1;
  server.listen(require('node:crypto').randomInt(49152, 65536), '127.0.0.1');
}
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && listenAttempts < 20) listen();
  else { console.error(error); process.exitCode = 1; clearTimeout(timeout); }
});
server.once('listening', () => console.log('CHAT_UI_FIXTURE_URL=http://127.0.0.1:' + server.address().port));
listen();
const timeout = setTimeout(() => { server.closeAllConnections(); server.close(); }, 10 * 60 * 1000);
process.on('SIGINT', () => { clearTimeout(timeout); server.closeAllConnections(); server.close(); });
