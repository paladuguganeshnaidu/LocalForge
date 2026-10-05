const assert = require('node:assert/strict');
const { test } = require('node:test');
const { OllamaProvider } = require('../dist/providers/ollamaProvider.js');
const { ModelRegistry } = require('../dist/providers/modelRegistry.js');
const { routeModel } = require('../dist/providers/modelRouter.js');

const definitions = [{ type: 'function', function: { name: 'create_file', description: 'Create a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }];

test('small models use advertised native tools and retain every streamed call and tool role', async () => {
  const originalFetch = global.fetch;
  let probes = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith('/api/show')) { probes += 1; return Response.json({ capabilities: ['completion', 'tools'] }); }
    const request = JSON.parse(options.body);
    assert.deepEqual(request.tools, definitions);
    assert.equal(request.messages.at(-1).role, 'tool');
    assert.equal(request.messages.at(-1).tool_name, 'list_directory');
    const chunks = ['first.md', 'second.md'].map(path => JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'create_file', arguments: { path, content: '# Created' } } }] } }));
    return new Response(chunks.join('\n') + '\n{"done":true}\n');
  };
  try {
    const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', undefined, global.fetch);
    const messages = [{ role: 'tool', name: 'list_directory', content: '[]' }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await provider.chatWithTools('qwen2.5-coder:1.5b', messages, definitions, undefined, () => {});
      assert.deepEqual(result.tool_calls.map(call => call.function.arguments.path), ['first.md', 'second.md']);
    }
    assert.equal(probes, 1);
  } finally { global.fetch = originalFetch; }
});

test('native request failures are reported once instead of silently retrying another protocol', async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async url => {
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['tools'] });
    requests += 1;
    return new Response('model ran out of memory', { status: 500 });
  };
  try {
    const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', undefined, global.fetch);
    await assert.rejects(provider.chatWithTools('small-model', [], definitions, undefined, () => {}), /500.*out of memory/);
    assert.equal(requests, 1);
  } finally { global.fetch = originalFetch; }
});

test('explicit unsupported-tools response falls back once and caches the protocol decision', async () => {
  const originalFetch = global.fetch;
  let nativeRequests = 0;
  let fallbackRequests = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith('/api/show')) return Response.json({});
    const request = JSON.parse(options.body);
    if (request.tools) { nativeRequests += 1; return new Response('model does not support tools', { status: 400 }); }
    fallbackRequests += 1;
    return Response.json({ message: { role: 'assistant', content: 'Ready' } });
  };
  try {
    const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', undefined, global.fetch);
    for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await provider.chatWithTools('unsupported', [], definitions)).content, 'Ready');
    assert.equal(nativeRequests, 1);
    assert.equal(fallbackRequests, 2);
  } finally { global.fetch = originalFetch; }
});

test('thinking-capable models have a separate opt-in and reasoning is retained but not streamed as chat', async () => {
  const originalFetch = global.fetch;
  let enabled = false;
  global.fetch = async (url, options) => {
    if (url.endsWith('/api/show')) return Response.json({ capabilities: ['tools', 'thinking'], thinking: { values: [true, false] } });
    const request = JSON.parse(options.body);
    assert.equal(request.think, enabled);
    assert.deepEqual(request.options, { num_ctx: 8192, num_predict: -1 });
    assert.equal(request.messages[0].thinking, 'Previous internal reasoning');
    assert.equal(request.messages.at(-1).content, 'Create the requested file.');
    assert.doesNotMatch(request.messages[1].content, /duplicate-long-description/);
    return new Response(JSON.stringify({ message: { thinking: 'Internal reasoning', content: 'Visible progress' }, done: true }) + '\n');
  };
  try {
    const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', () => ({ num_ctx: 8192, num_predict: -1, thinking: enabled }), global.fetch);
    for (enabled of [false, true]) {
      let visible = '';
      const result = await provider.chatWithTools('qwen3:4b', [{ role: 'assistant', content: '', thinking: 'Previous internal reasoning' }, { role: 'system', content: 'Keep safety instructions. <available_tools>duplicate-long-description</available_tools>' }, { role: 'user', content: 'Create the requested file.' }], definitions, undefined, delta => { visible += delta; });
      assert.equal(visible, 'Visible progress');
      assert.equal(result.thinking, 'Internal reasoning');
    }
  } finally { global.fetch = originalFetch; }
});

test('concurrent startup discovery shares one completed snapshot instead of returning an empty stale result', async () => {
  const registry = new ModelRegistry();
  let release;
  let probes = 0;
  const wait = new Promise(resolve => { release = resolve; });
  registry.registerProvider({ id: 'local-fixture', detect: async () => true, listModels: async () => { probes += 1; await wait; return [{ name: 'native-coder' }]; } });
  const first = registry.refresh();
  const second = registry.refresh();
  release();
  const results = await Promise.all([first, second]);
  assert.equal(probes, 1);
  assert.ok(results.every(models => models.length === 1));
  await registry.refresh();
  assert.equal(probes, 2);
});

test('agent auto-selection prefers a balanced local model over a tiny coder while respecting explicit selection', () => {
  const models = [
    { id: 'ollama:tiny', name: 'qwen2.5-coder:1.5b', size: 1.0 * 1024 ** 3, source: 'local', capabilities: { toolCalling: true, codeCompletion: true } },
    { id: 'ollama:balanced', name: 'qwen3:4b', size: 2.5 * 1024 ** 3, source: 'local', capabilities: { toolCalling: true } },
    { id: 'ollama:larger', name: 'llama3.1:8b', size: 4.9 * 1024 ** 3, source: 'local', capabilities: { toolCalling: true } }
  ];
  assert.equal(routeModel(models, 'agent').id, 'ollama:balanced');
  assert.equal(routeModel(models, 'agent', {}, 'ollama:tiny').id, 'ollama:tiny');
  assert.equal(routeModel(models, 'completion').id, 'ollama:tiny');
});
