const assert = require('node:assert/strict');
const { test } = require('node:test');

const { inferModelCapabilities } = require('../dist/providers/modelCapabilities.js');
const { ModelRegistry } = require('../dist/providers/modelRegistry.js');
const { routeModelWithReason, ModelRouter } = require('../dist/providers/modelRouter.js');

test('inferModelCapabilities identifies tool-capable coder models', () => {
  const caps = inferModelCapabilities('qwen2.5-coder:7b', 4 * 1024 * 1024 * 1024);
  assert.equal(caps.toolCalling, true);
  assert.equal(caps.codeCompletion, true);
  assert.equal(caps.chat, true);
  assert.equal(caps.reasoning, false);
  assert.equal(caps.contextWindow, 32768);
});

test('inferModelCapabilities identifies reasoning models', () => {
  const caps = inferModelCapabilities('deepseek-r1:14b', 9 * 1024 * 1024 * 1024);
  assert.equal(caps.reasoning, true);
  assert.equal(caps.chat, true);
});

test('inferModelCapabilities identifies vision models', () => {
  const caps = inferModelCapabilities('llava:7b', 4 * 1024 * 1024 * 1024);
  assert.equal(caps.vision, true);
  assert.equal(caps.codeCompletion, false);
});

test('ModelRegistry manages provider discovery and capability querying', async () => {
  const registry = new ModelRegistry();
  const mockProvider = {
    id: 'mock-ollama',
    detect: async () => true,
    listModels: async () => [
      { name: 'qwen2.5-coder:7b', size: 4000000000 },
      { name: 'llama3:8b', size: 4500000000 }
    ],
    streamChat: async () => {}
  };

  registry.registerProvider(mockProvider, 'local', 'http://127.0.0.1:11434');
  const discovered = await registry.discoverAll();

  assert.equal(discovered.length, 2);
  const toolModels = registry.filterByCapability((caps) => caps.toolCalling);
  assert.equal(toolModels.length, 2);

  const health = registry.getHealthReport();
  assert.equal(health[0].id, 'mock-ollama');
  assert.equal(health[0].healthy, true);
  assert.equal(health[0].modelCount, 2);
});

test('routeModelWithReason enforces tool-calling for agent tasks', () => {
  const models = [
    {
      name: 'basic-chat',
      capabilities: { chat: true, toolCalling: false, codeCompletion: false }
    },
    {
      name: 'tool-agent-coder',
      displayName: 'Qwen 2.5 Coder',
      capabilities: { chat: true, toolCalling: true, codeCompletion: true }
    }
  ];

  const result = routeModelWithReason(models, 'agent');
  assert.equal(result.model.name, 'tool-agent-coder');
  assert.match(result.reason, /tool-calling capability/);
});

test('routeModelWithReason prefers fast/small models for code completion', () => {
  const models = [
    {
      name: 'giant-coder',
      size: 32000000000,
      capabilities: { chat: true, toolCalling: true, codeCompletion: true }
    },
    {
      name: 'fast-coder',
      size: 1500000000,
      capabilities: { chat: true, toolCalling: true, codeCompletion: true }
    }
  ];

  const result = routeModelWithReason(models, 'completion');
  assert.equal(result.model.name, 'fast-coder');
  assert.match(result.reason, /fast code completions/);
});
