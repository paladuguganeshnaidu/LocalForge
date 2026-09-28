const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ModelRegistry } = require('../dist/providers/modelRegistry.js');
const { CompositeProvider } = require('../dist/providers/compositeProvider.js');
const { ModelRouter } = require('../dist/providers/modelRouter.js');

test('Remote End-to-End Fixture: SSH Connect -> Discovery -> Inference -> GPU telemetry -> Disconnect', async () => {
  const localProvider = {
    id: 'local-ollama',
    detect: async () => true,
    listModels: async () => [
      { name: 'llama3:8b', displayName: 'Llama 3 8B (Local)', size: 4000000000 }
    ],
    chatWithTools: async () => ({ role: 'assistant', content: 'Local response' })
  };

  const remoteProvider = {
    id: 'ssh-remote-dgx',
    detect: async () => true,
    listModels: async () => [
      {
        name: 'qwen2.5-coder:32b',
        displayName: 'Qwen 2.5 Coder 32B (DGX Remote)',
        size: 19000000000,
        capabilities: { chat: true, toolCalling: true, codeCompletion: true }
      }
    ],
    chatWithTools: async (model, messages) => ({
      role: 'assistant',
      content: `Remote GPU response for model ${model}: Task solved on remote DGX cluster.`
    })
  };

  const composite = new CompositeProvider([localProvider]);
  const registry = new ModelRegistry();
  registry.registerProvider(localProvider, 'local', 'http://127.0.0.1:11434');

  await registry.refresh();
  await composite.listModels();
  assert.equal(registry.getModels().length, 1);

  // 1. Establish SSH Remote Connection
  composite.registerProvider(remoteProvider);
  registry.registerProvider(
    remoteProvider,
    'remote',
    'http://127.0.0.1:2222',
    'NVIDIA A100-SXM4-80GB, 12240MiB / 81920MiB, 15%'
  );

  // 2. Discover remote models
  await registry.refresh();
  await composite.listModels();

  const allModels = registry.getModels();
  assert.equal(allModels.length, 2);

  const remoteModel = allModels.find((m) => m.source === 'remote');
  assert.ok(remoteModel);
  assert.equal(remoteModel.name, 'qwen2.5-coder:32b');
  assert.equal(remoteModel.gpuInfo, 'NVIDIA A100-SXM4-80GB, 12240MiB / 81920MiB, 15%');

  // 3. Select remote model through router
  const router = new ModelRouter(() => registry.getModels());
  const routing = router.route('agent', remoteModel.id);
  assert.equal(routing.modelId, remoteModel.id);

  // 4. Execute inference on remote model
  const resolved = composite.resolveProvider(routing.modelId);
  assert.ok(resolved);
  assert.equal(resolved.provider.id, 'ssh-remote-dgx');

  const inferenceResult = await resolved.provider.chatWithTools(
    resolved.actualName,
    [{ role: 'user', content: 'Run remote calculation' }]
  );
  assert.match(inferenceResult.content, /Task solved on remote DGX cluster/);

  // 5. Disconnect SSH Tunnel
  composite.unregisterProvider(remoteProvider.id);
  registry.unregisterProvider(remoteProvider.id);

  await registry.refresh();
  await composite.listModels();

  assert.equal(registry.getModels().length, 1);
  assert.equal(registry.getModels().find((m) => m.source === 'remote'), undefined);
  assert.equal(composite.resolveProvider(remoteModel.id), undefined);
});
