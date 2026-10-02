const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const vm = require('node:vm');
const commands = [];
const settings = new Map();
let confirmation;
const vscodeMock = {
  ConfigurationTarget: { Global: 1 },
  workspace: { getConfiguration: () => ({
    get: (key, fallback) => settings.get(key) ?? fallback,
    update: async (key, value) => { settings.set(key, value); }
  }) },
  commands: { executeCommand: async (...args) => { commands.push(args); } },
  window: { showWarningMessage: async () => confirmation }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.apply(this, arguments);
};
const { ModelCenterViewProvider } = require('../dist/ui/modelCenter.js');
Module._load = originalLoad;

test('Model Center renders a secure, syntactically valid management view', () => {
  const provider = new ModelCenterViewProvider({});
  const html = provider.getHtml({ cspSource: 'vscode-resource:' });
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];

  assert.ok(script);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Install from Ollama/);
  assert.match(html, /Search installed models/);
  assert.match(html, /Set as default/);
  assert.match(html, /Delete/);
  assert.doesNotThrow(() => new vm.Script(script));
});

const installedModel = { id: 'ollama:qwen%3Atest', name: 'ollama:qwen%3Atest', displayName: 'qwen:test', providerId: 'ollama', source: 'local' };

function attachView(provider) {
  const posts = [];
  let receive;
  let dispose;
  const view = {
    webview: {
      cspSource: 'vscode-resource:',
      postMessage: async (message) => { posts.push(message); },
      onDidReceiveMessage: (handler) => { receive = handler; return { dispose() {} }; }
    },
    onDidDispose: (handler) => { dispose = handler; return { dispose() {} }; }
  };
  provider.resolveWebviewView(view);
  return { posts, send: (message) => receive(message), dispose: () => dispose() };
}

function controlledDownloads(ignoreAbort = false) {
  const pulls = [];
  return {
    pulls,
    provider: {
      listModels: async () => [installedModel],
      detect: async () => true,
      pullModel: (name, onProgress, signal) => new Promise((resolve, reject) => {
        pulls.push({ name, resolve, onProgress, signal });
        if (!ignoreAbort) signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    }
  };
}

test('Use in chat routes the discovered canonical model and rejects stale selections', async () => {
  commands.length = 0;
  const center = new ModelCenterViewProvider({ listModels: async () => [installedModel] });
  const view = attachView(center);
  await view.send({ type: 'selectModel', model: installedModel.id });
  assert.deepEqual(commands, [['localforge.setModel', installedModel.id], ['localforge.chatView.focus']]);
  await view.send({ type: 'selectModel', model: 'missing' });
  assert.equal(commands.length, 2);
  assert.equal(view.posts.at(-1).type, 'modelCenterNotice');
  assert.match(view.posts.at(-1).message, /no longer available/);
});

test('pause, view recreation, resume, and cancel preserve one authoritative download', async () => {
  const controlled = controlledDownloads();
  const center = new ModelCenterViewProvider(controlled.provider);
  const view = attachView(center);
  const first = view.send({ type: 'installModel', model: 'qwen:test' });
  await view.send({ type: 'pauseModelInstall' });
  await first;
  assert.equal(view.posts.at(-1).state, 'paused');
  await view.send({ type: 'installModel', model: 'different:test' });
  assert.equal(controlled.pulls.length, 1);
  assert.equal(view.posts.at(-1).type, 'modelCenterNotice');
  await view.send({ type: 'setDefaultModel', modelId: installedModel.id });
  view.dispose();
  const restored = attachView(center);
  await restored.send({ type: 'ready' });
  assert.equal(restored.posts.at(-1).state, 'paused');
  assert.equal(restored.posts.at(-1).model, 'qwen:test');
  const resumed = restored.send({ type: 'installModel', model: 'qwen:test' });
  assert.equal(controlled.pulls.length, 2);
  controlled.pulls[1].resolve();
  await resumed;
  assert.equal(restored.posts.at(-1).state, 'complete');
  const cancelled = restored.send({ type: 'installModel', model: 'other:test' });
  await restored.send({ type: 'cancelModelInstall' });
  await cancelled;
  assert.equal(restored.posts.at(-1).state, 'cancelled');
});

test('cancellation takes precedence over a provider that resolves after abort', async () => {
  const controlled = controlledDownloads(true);
  const center = new ModelCenterViewProvider(controlled.provider);
  const view = attachView(center);
  const running = view.send({ type: 'installModel', model: 'qwen:test' });
  await view.send({ type: 'cancelModelInstall' });
  controlled.pulls[0].onProgress({ status: 'late update' });
  controlled.pulls[0].resolve();
  await running;
  assert.equal(view.posts.at(-1).state, 'cancelled');
  assert.ok(!view.posts.some((message) => message.state === 'complete'));
  assert.ok(!view.posts.some((message) => message.progress?.status === 'late update'));
});

test('an active download continues across view disposal and is aborted on extension disposal', async () => {
  const controlled = controlledDownloads();
  const center = new ModelCenterViewProvider(controlled.provider);
  const view = attachView(center);
  const running = view.send({ type: 'installModel', model: 'qwen:test' });
  controlled.pulls[0].onProgress({ status: 'pulling layers', total: 100, completed: 25 });
  view.dispose();
  assert.equal(controlled.pulls[0].signal.aborted, false);
  const restored = attachView(center);
  await restored.send({ type: 'ready' });
  assert.equal(restored.posts.at(-1).state, 'progress');
  assert.equal(restored.posts.at(-1).progress.completed, 25);
  center.dispose();
  await running;
  assert.equal(controlled.pulls[0].signal.aborted, true);
});

test('unreachable providers report a useful discovery error', async () => {
  let reachable = false;
  const center = new ModelCenterViewProvider({ listModels: async () => [], detect: async () => reachable });
  const view = attachView(center);
  await view.send({ type: 'ready' });
  assert.equal(view.posts.at(-1).type, 'modelCenterNotice');
  assert.match(view.posts.at(-1).message, /Start Ollama/);
  reachable = true;
  await view.send({ type: 'refresh' });
  assert.equal(view.posts.at(-1).message, '');
});

test('deletion requires confirmation and is blocked while downloading', async () => {
  const controlled = controlledDownloads();
  const deleted = [];
  controlled.provider.deleteModel = async (id) => deleted.push(id);
  const center = new ModelCenterViewProvider(controlled.provider);
  const view = attachView(center);
  confirmation = undefined;
  await view.send({ type: 'deleteModel', modelId: installedModel.id });
  assert.equal(deleted.length, 0);
  const running = view.send({ type: 'installModel', model: 'qwen:test' });
  confirmation = 'Delete Model';
  await view.send({ type: 'deleteModel', modelId: installedModel.id });
  assert.equal(deleted.length, 0);
  assert.match(view.posts.at(-1).message, /cancel the model download/);
  await view.send({ type: 'cancelModelInstall' });
  await running;
  await view.send({ type: 'deleteModel', modelId: installedModel.id });
  assert.deepEqual(deleted, [installedModel.id]);
});

test('model changes refresh the runtime registry before selecting or using the new model', async () => {
  let refreshes = 0;
  const provider = {
    listModels: async () => [installedModel],
    pullModel: async () => {},
    deleteModel: async () => {}
  };
  const center = new ModelCenterViewProvider(provider, async () => { refreshes += 1; });
  const view = attachView(center);
  await view.send({ type: 'installModel', model: 'qwen:test' });
  assert.equal(refreshes, 1);
  await view.send({ type: 'selectModel', model: installedModel.id });
  assert.equal(refreshes, 2);
  await view.send({ type: 'setDefaultModel', modelId: installedModel.id });
  assert.equal(refreshes, 3);
  confirmation = 'Delete Model';
  await view.send({ type: 'deleteModel', modelId: installedModel.id });
  assert.equal(refreshes, 4);
});

test('browser controls stay usable through notices, pause, and resume', () => {
  const center = new ModelCenterViewProvider({});
  const script = center.getHtml({ cspSource: 'vscode-resource:' }).match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const sent = [];
  let receive;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false, disabled: false,
      handlers: {},
      addEventListener(name, handler) { this.handlers[name] = handler; },
      removeAttribute() {}, replaceChildren() {}, appendChild() {}
    });
    return elements.get(id);
  };
  vm.runInNewContext(script, {
    acquireVsCodeApi: () => ({ postMessage: (message) => sent.push(message) }),
    document: { getElementById: element },
    window: { addEventListener: (_, handler) => { receive = handler; } }
  });
  receive({ data: { type: 'modelCenterStatus', state: 'progress', model: 'qwen:test', progress: { status: 'Downloading' } } });
  assert.equal(element('install').disabled, true);
  assert.equal(element('pause').hidden, false);
  receive({ data: { type: 'modelCenterNotice', state: 'complete', message: 'Default changed' } });
  assert.equal(element('install').disabled, true);
  assert.equal(element('cancel').hidden, false);
  receive({ data: { type: 'modelCenterStatus', state: 'paused', model: 'qwen:test' } });
  assert.equal(element('install').textContent, 'Resume download');
  assert.equal(element('modelName').disabled, true);
  receive({ data: { type: 'modelCenterNotice', state: 'error', message: 'Discovery failed' } });
  assert.equal(element('cancel').hidden, false);
  element('install').handlers.click();
  assert.equal(sent.at(-1).type, 'installModel');
  assert.equal(sent.at(-1).model, 'qwen:test');
  receive({ data: { type: 'modelCenterStatus', state: 'complete' } });
  assert.equal(element('install').disabled, false);
  assert.equal(element('modelName').disabled, false);
  assert.equal(element('pause').hidden, true);
  assert.equal(element('cancel').hidden, true);
});
