const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ModelRegistry } = require('../dist/providers/modelRegistry.js');
const { ModelRouter, routeModelWithReason } = require('../dist/providers/modelRouter.js');
const { CompositeProvider } = require('../dist/providers/compositeProvider.js');

test('ModelRef canonical identity maps consistently across registry, router, and composite provider', async () => {
  const fakeLocalProvider = {
    id: 'ollama',
    listModels: async () => [
      {
        name: 'qwen2.5-coder:14b',
        displayName: 'Qwen 2.5 Coder 14B',
        size: 9000000000,
        capabilities: { chat: true, toolCalling: true, codeCompletion: true }
      }
    ]
  };

  const fakeRemoteProvider = {
    id: 'remote-ssh',
    listModels: async () => [
      {
        name: 'qwen2.5-coder:32b',
        displayName: 'Qwen 2.5 Coder 32B (Remote)',
        size: 20000000000,
        capabilities: { chat: true, toolCalling: true, codeCompletion: true }
      }
    ]
  };

  const composite = new CompositeProvider([fakeLocalProvider, fakeRemoteProvider]);
  const registry = new ModelRegistry();
  registry.registerProvider(fakeLocalProvider, 'local', 'http://127.0.0.1:11434');
  registry.registerProvider(fakeRemoteProvider, 'remote', 'http://127.0.0.1:11435');

  await registry.refresh();
  await composite.listModels();
  const models = registry.getModels();

  assert.equal(models.length, 2);
  const localModel = models.find((m) => m.source === 'local');
  const remoteModel = models.find((m) => m.source === 'remote');

  assert.ok(localModel);
  assert.ok(remoteModel);
  assert.equal(localModel.id, 'ollama:qwen2.5-coder%3A14b');
  assert.equal(remoteModel.id, 'remote-ssh:qwen2.5-coder%3A32b');

  // Verify router selecting by canonical id
  const router = new ModelRouter(() => registry.getModels());
  const localRoute = router.route('agent', localModel.id);
  assert.equal(localRoute.modelId, localModel.id);

  const remoteRoute = router.route('agent', remoteModel.id);
  assert.equal(remoteRoute.modelId, remoteModel.id);

  // Verify composite provider resolves canonical id
  const resolvedLocal = composite.resolveProvider(localModel.id);
  assert.equal(resolvedLocal?.provider.id, 'ollama');

  const resolvedRemote = composite.resolveProvider(remoteModel.id);
  assert.equal(resolvedRemote?.provider.id, 'remote-ssh');
});

test('UI selecting a model executes exactly that model by canonical ModelRef.id', () => {
  const models = [
    {
      id: 'ollama:qwen2.5-coder%3A7b',
      name: 'qwen2.5-coder:7b',
      displayName: 'Qwen 7B',
      providerId: 'ollama',
      source: 'local',
      capabilities: { chat: true, toolCalling: true }
    },
    {
      id: 'remote-ssh:qwen2.5-coder%3A32b',
      name: 'qwen2.5-coder:32b',
      displayName: 'Qwen 32B (DGX)',
      providerId: 'remote-ssh',
      source: 'remote',
      capabilities: { chat: true, toolCalling: true }
    }
  ];

  const res = routeModelWithReason(models, 'agent', {}, 'remote-ssh:qwen2.5-coder%3A32b');
  assert.ok(res);
  assert.equal(res.model.id, 'remote-ssh:qwen2.5-coder%3A32b');
  assert.match(res.reason, /User selected/);
});
