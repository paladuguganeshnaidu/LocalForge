const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const http = require('node:http');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'vscode' ? { window: { showWarningMessage: () => assert.fail('Pinned fixture needs no trust prompt') } } : originalLoad.call(this, request, parent, isMain);
};
const { RemoteManager } = require('../dist/remote/remoteManager');
Module._load = originalLoad;
const { SshOllamaTunnel } = require('../dist/remote/sshOllamaTunnel');
const { CompositeProvider } = require('../dist/providers/compositeProvider');
const { ModelRegistry } = require('../dist/providers/modelRegistry');
const { canonicalModelId } = require('../dist/providers/endpointConfiguration');

test('remote manager forwards live configured Ollama generation settings through its actual provider request', async () => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end('{"message":{"content":"REMOTE_OPTIONS_OK"},"done":true}\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const originalOpen = SshOllamaTunnel.open;
  let closed = false;
  SshOllamaTunnel.open = async () => ({ port: server.address().port, isConnected: true, onDidClose: () => ({ dispose() {} }), getGpuStatus: async () => '', close: async () => { closed = true; } });
  const values = new Map();
  const context = { globalState: { get: (key, fallback) => values.get(key) ?? fallback, update: async (key, value) => values.set(key, value) }, secrets: { get: async () => '{"secret":"fixture-only"}' } };
  let configuredContext = 8192;
  const manager = new RemoteManager(context, new CompositeProvider([]), undefined, () => ({ num_ctx: configuredContext, num_predict: -1, temperature: 0.1 }));
  let provider;
  try {
    await manager.saveProfile({ id: 'options-fixture', name: 'Owned options fixture', host: '127.0.0.1', username: 'fixture', authenticationMethod: 'password' });
    provider = (await manager.connect('options-fixture')).provider;
    let text = '';
    await provider.streamChat('fixture', [{ role: 'user', content: 'Verify options' }], token => { text += token; });
    assert.equal(text, 'REMOTE_OPTIONS_OK');
    assert.deepEqual(requests[0].options, { num_ctx: 8192, num_predict: -1, temperature: 0.1 });
    configuredContext = 4096;
    await provider.streamChat('fixture', [{ role: 'user', content: 'Verify updated options' }], () => {});
    assert.equal(requests[1].options.num_ctx, 4096);
    await manager.disconnect();
    assert.equal(closed, true);
  } finally {
    await manager.disconnect();
    provider?.dispose();
    SshOllamaTunnel.open = originalOpen;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('unexpected remote closure removes only its provider/models and a stale session cannot remove its replacement', async () => {
  const server = http.createServer((request, response) => {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.end(request.url === '/api/tags' ? '{"models":[{"name":"fixture"}]}' : '{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const tunnels = [];
  const originalOpen = SshOllamaTunnel.open;
  SshOllamaTunnel.open = async () => {
    const tunnel = { port: server.address().port, isConnected: true, getGpuStatus: async () => '',
      onDidClose(listener) { this.listener = listener; return { dispose() {} }; },
      async close() { this.isConnected = false; },
      lose() { this.isConnected = false; this.listener(new Error('SSH fixture disconnected')); }
    };
    tunnels.push(tunnel);
    return tunnel;
  };
  const values = new Map();
  const context = { globalState: { get: (key, fallback) => values.get(key) ?? fallback, update: async (key, value) => values.set(key, value) }, secrets: { get: async () => undefined } };
  const registry = new ModelRegistry();
  const composite = new CompositeProvider([], registry);
  const events = [];
  const manager = new RemoteManager(context, composite, registry, undefined, reason => events.push(reason?.message ?? 'Disconnected by user'));
  try {
    await manager.saveProfile({ id: 'closure', name: 'Owned closure fixture', host: '127.0.0.1', username: 'fixture', authenticationMethod: 'password' });
    const first = await manager.connect('closure');
    const explicitSelection = canonicalModelId(first.providerId, 'fixture');
    assert.ok(composite.resolveRoute(explicitSelection));
    tunnels[0].lose();
    assert.equal(manager.getActiveSession(), undefined);
    assert.equal(registry.getModels().length, 0);
    assert.equal(composite.getProviders().length, 0);
    assert.equal(composite.resolveRoute(explicitSelection), undefined);
    assert.deepEqual(events, ['SSH fixture disconnected']);
    const second = await manager.connect('closure');
    tunnels[0].listener(new Error('Late close from old connection'));
    assert.equal(manager.getActiveSession(), second);
    assert.equal(registry.getProvider(second.providerId), second.provider);
    assert.ok(composite.resolveRoute(explicitSelection));
    await manager.disconnect();
    assert.equal(manager.getActiveSession(), undefined);
    assert.equal(registry.getModels().length, 0);
    assert.equal(tunnels[1].isConnected, false);
  } finally {
    await manager.disconnect();
    SshOllamaTunnel.open = originalOpen;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('disconnect during remote GPU setup does not resurrect its provider or clear a newer same-profile session', async () => {
  let releaseGpuProbe;
  const blockedGpuProbe = new Promise(resolve => { releaseGpuProbe = resolve; });
  const tunnels = [];
  const originalOpen = SshOllamaTunnel.open;
  SshOllamaTunnel.open = async () => {
    const tunnel = { port: 12345, isConnected: true, getGpuStatus: async () => tunnels.length === 1 ? blockedGpuProbe : '',
      onDidClose: () => ({ dispose() {} }), close: async () => { tunnel.isConnected = false; }
    };
    tunnels.push(tunnel);
    return tunnel;
  };
  const values = new Map();
  const context = { globalState: { get: (key, fallback) => values.get(key) ?? fallback, update: async (key, value) => values.set(key, value) }, secrets: { get: async () => undefined } };
  const composite = new CompositeProvider([]);
  const manager = new RemoteManager(context, composite);
  try {
    await manager.saveProfile({ id: 'setup-race', host: '127.0.0.1', username: 'fixture', authenticationMethod: 'password' });
    const first = manager.connect('setup-race');
    const rejected = assert.rejects(first, /closed or was cancelled during setup/);
    while (tunnels.length === 0) await new Promise(resolve => setImmediate(resolve));
    await manager.disconnect();
    assert.equal(composite.getProviders().length, 0);
    const second = await manager.connect('setup-race');
    releaseGpuProbe('');
    await rejected;
    assert.equal(manager.getActiveSession(), second);
    assert.deepEqual(composite.getProviders(), [second.provider]);
    assert.equal(tunnels[0].isConnected, false);
    assert.equal(tunnels[1].isConnected, true);
  } finally {
    releaseGpuProbe('');
    await manager.disconnect();
    SshOllamaTunnel.open = originalOpen;
  }
});
