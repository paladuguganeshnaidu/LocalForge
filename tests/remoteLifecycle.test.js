const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ModelRegistry } = require('../dist/providers/modelRegistry.js');
const { CompositeProvider } = require('../dist/providers/compositeProvider.js');

test('Remote model lifecycle registers with CompositeProvider and ModelRegistry, and cleans up on disconnect', async () => {
  const localProvider = {
    id: 'ollama',
    listModels: async () => [{ name: 'llama3:8b', displayName: 'Llama 3 8B' }]
  };

  const remoteProvider = {
    id: 'remote-tunnel-123',
    listModels: async () => [{ name: 'qwen2.5-coder:32b', displayName: 'Qwen 32B (DGX)' }]
  };

  const composite = new CompositeProvider([localProvider]);
  const registry = new ModelRegistry();
  registry.registerProvider(localProvider, 'local', 'http://127.0.0.1:11434');

  await registry.refresh();
  let compModels = await composite.listModels();
  assert.equal(registry.getModels().length, 1);
  assert.equal(compModels.length, 1);

  // 1. Remote connection established
  composite.registerProvider(remoteProvider);
  registry.registerProvider(remoteProvider, 'remote', 'http://127.0.0.1:11435');

  await registry.refresh();
  compModels = await composite.listModels();
  const modelsAfterConnect = registry.getModels();
  assert.equal(modelsAfterConnect.length, 2);
  assert.equal(compModels.length, 2);

  const remoteModel = modelsAfterConnect.find((m) => m.source === 'remote');
  assert.ok(remoteModel);
  assert.equal(remoteModel.name, 'qwen2.5-coder:32b');

  // Verify composite provider resolves remote model
  const resolved = composite.resolveProvider(remoteModel.id);
  assert.equal(resolved?.provider.id, 'remote-tunnel-123');

  // 2. Disconnect remote
  composite.unregisterProvider(remoteProvider.id);
  registry.unregisterProvider(remoteProvider.id);

  compModels = await composite.listModels();
  assert.equal(registry.getModels().length, 1);
  assert.equal(compModels.length, 1);
  assert.equal(composite.resolveProvider(remoteModel.id), undefined);
});
