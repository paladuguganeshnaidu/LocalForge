const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request) { return request === 'vscode' ? { workspace: { workspaceFolders: [{ uri: {} }] } } : originalLoad.apply(this, arguments); };
const { registerSubagentTools } = require('../dist/agent/subagentTools');
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const definition = name => ({ type: 'function', function: { name, description: name, parameters: {} } });

function fixture(provider, approval = async () => true) {
  const registry = new ToolRegistry();
  const permissions = new PermissionManager('always_ask', approval);
  registry.registerTool(definition('read_file'), async () => ({ content: 'Actual saved source' }));
  registry.registerTool(definition('run_command'), async () => { throw new Error('Child must not execute'); });
  registry.registerTool(definition('write_file'), async () => { throw new Error('Child must not write'); });
  const progress = [];
  registerSubagentTools(registry, permissions, provider, () => 'selected-model', message => progress.push(message));
  return { registry, permissions, progress };
}

test('delegated worker uses the selected model, real inspections and non-recursive read-only definitions', async () => {
  let calls = 0;
  const provider = { id: 'fixture', chatWithTools: async (model, _messages, tools) => {
    assert.equal(model, 'selected-model');
    assert.deepEqual(tools.map(tool => tool.function.name), ['read_file']);
    calls += 1;
    return calls === 1 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'README.md' } } }] } : { role: 'assistant', content: 'The saved source contains Actual saved source.' };
  } };
  const { registry, permissions, progress } = fixture(provider);
  const result = await registry.executeTool('delegate_task', { role: 'repository_analyst', task: 'Read README.md and summarize its actual contents.' }, permissions);
  assert.equal(result.success, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.inspections.length, 1);
  assert.equal(result.inspections[0].result.content, 'Actual saved source');
  assert.ok(progress.some(message => message.includes('Reading with read_file')));
  assert.ok(registry.hasTool('delegate_task'));
});

test('denied delegation never invokes the model and invalid roles cannot expand privileges', async () => {
  let calls = 0;
  const { registry, permissions } = fixture({ chatWithTools: async () => { calls += 1; throw new Error('No inference expected'); } }, async () => false);
  await assert.rejects(registry.executeTool('delegate_task', { role: 'planner', task: 'Plan' }, permissions), /denied|blocked|rejected/i);
  assert.equal(calls, 0);
  await assert.rejects(registry.executeTool('delegate_task', { role: 'coder', task: 'Write' }, new PermissionManager('always_ask', async () => true)), /supported read-only role/);
  assert.equal(calls, 0);
});

test('cancelling a worker settles it and releases capacity for a later delegation', async () => {
  let waiting;
  let first = true;
  const provider = { id: 'fixture', chatWithTools: async (_model, _messages, _tools, signal) => {
    if (!first) return { role: 'assistant', content: 'A short plan.' };
    first = false;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Cancelled inference')), { once: true });
      waiting();
    });
  } };
  const { registry, permissions } = fixture(provider);
  const controller = new AbortController();
  const started = new Promise(resolve => { waiting = resolve; });
  const pending = registry.executeTool('delegate_task', { role: 'planner', task: 'Plan a minimal project' }, permissions, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, /cancel|abort/i);
  const result = await registry.executeTool('delegate_task', { role: 'planner', task: 'Plan a minimal project' }, permissions);
  assert.equal(result.status, 'completed');
});
