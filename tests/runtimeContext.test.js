const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { advertisedContextWindow, evaluateRuntimeCapabilities } = require('../dist/providers/modelCapabilities');
const { ModelRegistry } = require('../dist/providers/modelRegistry');
const { OllamaProvider } = require('../dist/providers/ollamaProvider');

test('runtime context metadata replaces name heuristics without accepting unbounded or unrelated fields', async () => {
  const metadata = { capabilities: ['completion', 'tools', 'thinking'], model_info: { 'general.architecture': 'qwen35', 'qwen35.context_length': 262144 } };
  assert.equal(advertisedContextWindow(metadata), 262144);
  assert.equal(evaluateRuntimeCapabilities('qwen3.5:9b', undefined, metadata).contextWindow, 262144);
  for (const context of ['262144', -1, Infinity, 1048577, 16.5, 0]) assert.equal(advertisedContextWindow({ ...metadata, model_info: { 'general.architecture': 'qwen35', 'qwen35.context_length': context } }), undefined);
  assert.equal(advertisedContextWindow({ model_info: { 'other.context_length': 262144 } }), undefined);
  const registry = new ModelRegistry();
  registry.registerProvider({ id: 'ollama', detect: async () => true, listModels: async () => [{ name: 'qwen3.5:9b' }], showModel: async () => metadata }, 'local');
  await registry.refresh();
  assert.equal(registry.getModels()[0].capabilities.contextWindow, 262144);
  assert.equal(registry.getModels()[0].capabilities.confidence.contextWindow, 'high');
});

test('actual Ollama requests honor both the configured ceiling and the server-advertised model limit', async () => {
  const received = [];
  let advertised = 16384;
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      if (request.url === '/api/show') return response.end(JSON.stringify({ capabilities: ['tools'], model_info: { 'general.architecture': 'fixture', 'fixture.context_length': advertised } }));
      received.push(JSON.parse(body));
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end('{"message":{"content":"ACTUAL_CONTEXT_OK"},"done":true}\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let configured = 32768;
  const provider = new OllamaProvider(`http://127.0.0.1:${server.address().port}`, 'fixture', () => ({ num_ctx: configured, num_predict: -1 }));
  try {
    await provider.showModel('fixture');
    await provider.streamChat('fixture', [{ role: 'user', content: 'Verify bounded context' }], () => {});
    assert.equal(received[0].options.num_ctx, 16384);
    configured = 4096;
    await provider.streamChat('fixture', [{ role: 'user', content: 'Verify smaller configured context' }], () => {});
    assert.equal(received[1].options.num_ctx, 4096);
    advertised = 8192;
    configured = 32768;
    await provider.showModel('fixture');
    await provider.streamChat('fixture', [{ role: 'user', content: 'Verify changed model metadata' }], () => {});
    assert.equal(received[2].options.num_ctx, 8192);
  } finally {
    provider.dispose();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
