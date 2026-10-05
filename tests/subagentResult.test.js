const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function(request) { return request === 'vscode' ? {} : originalLoad.apply(this, arguments); };
const { AgentManager } = require('../dist/agent/orchestration/agentManager');
const { AgentPool } = require('../dist/agent/orchestration/agentPool');
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');

const context = () => ({ agentId: 'worker', role: 'coder', task: 'Inspect the requested file.', workspaceRoot: {}, relevantFiles: [], modelCapabilities: { contextWindow: 8192 }, toolPermissions: ['read'], budget: { maxTokens: 4000, maxRounds: 10, maxToolCalls: 4, timeoutMs: 5000, retryLimit: 0 } });
const definition = name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } } } });

test('failed worker tool loops cannot emit completed or successful handoffs', async () => {
  const registry = new ToolRegistry();
  registry.registerTool(definition('read_file'), async () => { throw new Error('ENOENT: missing file'); });
  const provider = { id: 'fixture', chatWithTools: async () => ({ role: 'assistant', content: '', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'missing.py' } } }] }) };
  const pool = new AgentPool(1);
  const events = [];
  const result = await new AgentManager(provider, registry, new PermissionManager(), pool).executeSubagent(context(), 'fixture', { onLifecycleEvent: event => events.push(event.state) });
  assert.equal(result.status, 'failed');
  assert.equal(result.handoff, undefined);
  assert.ok(events.includes('FAILED'));
  assert.ok(!events.includes('COMPLETED'));
  assert.equal(pool.getActiveCount(), 0);
});

test('worker scopes intersect parent permissions rather than adding role privileges', async () => {
  const registry = new ToolRegistry();
  registry.registerTool(definition('read_file'), async () => ({ content: 'data' }));
  registry.registerTool(definition('write_file'), async () => { throw new Error('Must not write'); });
  const provider = { id: 'fixture', chatWithTools: async (_model, _messages, tools) => {
    assert.ok(tools.some(tool => tool.function.name === 'read_file'));
    assert.ok(!tools.some(tool => tool.function.name === 'write_file'));
    return { role: 'assistant', content: 'No modifications requested.' };
  } };
  const result = await new AgentManager(provider, registry, new PermissionManager(), new AgentPool(1)).executeSubagent(context(), 'fixture');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.filesModified, []);
});

test('pool capacity exposes real available slots and rejects invalid concurrency', () => {
  assert.throws(() => new AgentPool(0), /1 to 16/);
  const pool = new AgentPool(2);
  assert.equal(pool.getAvailableSlots(), 2);
  pool.acquire('one', 'coder', 'task');
  assert.equal(pool.getAvailableSlots(), 1);
  pool.release('one');
  assert.equal(pool.getAvailableSlots(), 2);
});

test('cancelled workers keep their slot until execution actually settles', () => {
  const pool = new AgentPool(1);
  const controller = pool.acquire('worker', 'coder', 'task');
  assert.equal(pool.cancel('worker'), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(pool.getAvailableSlots(), 0);
  assert.throws(() => pool.acquire('other', 'coder', 'task'), /capacity/);
  pool.release('worker');
  assert.equal(pool.getAvailableSlots(), 1);
});

test('pool prevents duplicate ownership and detaches released parent listeners', () => {
  const pool = new AgentPool(2);
  const parent = new AbortController();
  const controller = pool.acquire('worker', 'coder', 'task', parent.signal);
  assert.throws(() => pool.acquire('worker', 'coder', 'task'), /already running/);
  pool.release('worker');
  parent.abort();
  assert.equal(controller.signal.aborted, false);
  const other = pool.acquire('other', 'coder', 'task');
  pool.cancelAll();
  assert.equal(other.signal.aborted, true);
  assert.equal(pool.getActiveCount(), 1);
  pool.release('other');
  assert.equal(pool.getActiveCount(), 0);
});

test('test and review handoffs do not certify success from reassuring model text', async () => {
  const provider = { id: 'fixture', chatWithTools: async () => ({ role: 'assistant', content: 'Everything passed. The code is clean.' }) };
  const manager = new AgentManager(provider, new ToolRegistry(), new PermissionManager(), new AgentPool(1));
  const tester = await manager.executeSubagent({ ...context(), role: 'test_engineer' }, 'fixture');
  assert.equal(tester.handoff.data.testsRun, 0);
  assert.equal(tester.handoff.data.passed, false);
  const reviewer = await manager.executeSubagent({ ...context(), role: 'reviewer' }, 'fixture');
  assert.equal(reviewer.handoff.type, 'generic');
  assert.equal(reviewer.handoff.data.verifiedApproval, false);
});
