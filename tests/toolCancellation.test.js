const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.apply(this, arguments);
};
const { AgentEngine } = require('../dist/agent/agentEngine.js');
const { LocalForgeEngine } = require('../dist/core/LocalForgeEngine.js');
Module._load = originalLoad;

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

const definition = { type: 'function', function: {
  name: 'write_workspace_file', description: 'Write a test file', parameters: {}
} };

function provider() {
  let calls = 0;
  return {
    id: 'cancellation-fixture',
    chatWithTools: async () => ++calls === 1 ? {
      role: 'assistant', content: '', tool_calls: [{ id: 'write-1', function: {
        name: definition.function.name, arguments: { path: 'safe.txt', content: 'safe' }
      } }]
    } : { role: 'assistant', content: 'Done.' }
  };
}

test('completion classification uses the original task rather than access policy and retrieved context', async () => {
  const task = 'Create a file named package.json containing the supplied JSON. Do not modify any other files. If the file exists, stop and tell me. Confirm the saved file without claiming that an application was built.';
  const wrapped = `Access scope: Project workspace.\n\nTask:\n${task}\n\nworkspace_summary: Existing application metadata, build project and browser verification.`;
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'create_file', description: 'Create file', parameters: {} } }, async () => ({ applied: true, path: 'package.json' }));
  let calls = 0;
  const model = { id: 'fixture', chatWithTools: async () => ++calls === 1 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'create_file', arguments: { path: 'package.json', json: { name: 'fixture' } } } }] } : { role: 'assistant', content: 'Created package.json. No other files changed.' } };
  const result = await new AgentEngine(registry, new PermissionManager('always_ask', async () => true)).runTask(model, 'fixture', [{ role: 'user', content: wrapped }], { taskPrompt: task, maxRounds: 4 });
  assert.equal(result.status, 'completed');
  assert.equal(result.task, task);
  assert.equal(calls, 2);
  assert.deepEqual(result.filesModified, ['package.json']);
});

test('cancelling an approval wait prevents late approval from executing the tool', async () => {
  const approval = deferred();
  const requested = deferred();
  const permissions = new PermissionManager('always_ask', async (request) => {
    requested.resolve(request);
    return approval.promise;
  });
  const registry = new ToolRegistry();
  let mutations = 0;
  registry.registerTool(definition, async () => { mutations += 1; }, 'edit');
  const controller = new AbortController();
  const outcome = registry.executeTool(definition.function.name, {}, permissions, { signal: controller.signal })
    .then(() => ({ resolved: true }), (error) => ({ error }));
  await requested.promise;
  controller.abort();
  const immediate = await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 80))]);
  approval.resolve(true);
  await outcome;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mutations, 0, 'A late approval must never start a cancelled tool');
  assert.equal(immediate.error?.name, 'AbortError', 'Cancellation should resolve the wait promptly');
});

test('AgentLoop cancels pending permissions and records the cancelled tool without executing it', async () => {
  const approval = deferred();
  const requested = deferred();
  const permissions = new PermissionManager('always_ask', async () => {
    requested.resolve();
    return approval.promise;
  });
  const registry = new ToolRegistry();
  let executions = 0;
  registry.registerTool(definition, async () => { executions += 1; return { success: true }; }, 'edit');
  const controller = new AbortController();
  let state;
  const outcome = new AgentLoop(provider(), registry, permissions).run('fixture', [{ role: 'user', content: 'Write a file' }], {
    signal: controller.signal, onStateUpdate: (value) => { state = value; }
  }).then(() => ({ resolved: true }), (error) => ({ error }));
  await requested.promise;
  controller.abort();
  approval.resolve(true);
  const result = await outcome;
  assert.ok(result.error);
  assert.equal(executions, 0);
  assert.equal(state.status, 'cancelled');
  assert.equal(state.steps[0].toolCalls[0].status, 'cancelled');
});

test('approval wait does not consume the per-tool execution deadline', async () => {
  const permissions = new PermissionManager('always_ask', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return true;
  });
  const registry = new ToolRegistry();
  registry.registerTool(definition, async () => ({ success: true }), 'edit');
  const result = await new AgentLoop(provider(), registry, permissions).run('fixture', [{ role: 'user', content: 'Write a file' }], {
    toolTimeoutMs: 20
  });
  assert.equal(result.state.steps[0].toolCalls[0].status, 'success');
});

test('execution deadlines abort the handler context before a delayed mutation', async () => {
  const gate = deferred();
  const finished = deferred();
  let mutations = 0;
  let signal;
  const registry = new ToolRegistry();
  registry.registerTool(definition, async (_args, context) => {
    signal = context.signal;
    try {
      await gate.promise;
      context.signal.throwIfAborted();
      mutations += 1;
    } finally {
      finished.resolve();
    }
  }, { category: 'edit', timeout: 20 });
  const outcome = registry.executeTool(definition.function.name, {})
    .then(() => ({ resolved: true }), (error) => ({ error }));
  const result = await outcome;
  gate.resolve();
  await finished.promise;
  assert.equal(result.error?.name, 'TimeoutError');
  assert.equal(signal.aborted, true);
  assert.equal(mutations, 0);
});

test('cancellation does not wait for a provider that ignores the abort signal', async () => {
  const response = deferred();
  const started = deferred();
  const controller = new AbortController();
  let mutations = 0;
  const registry = new ToolRegistry();
  registry.registerTool(definition, async () => { mutations += 1; }, 'edit');
  const outcome = new AgentLoop({
    id: 'ignores-cancellation',
    chatWithTools: async () => { started.resolve(); return response.promise; }
  }, registry).run('fixture', [{ role: 'user', content: 'Write a file' }], {
    signal: controller.signal
  }).then(() => ({ resolved: true }), (error) => ({ error }));
  await started.promise;
  controller.abort();
  const immediate = await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 80))]);
  response.resolve({ role: 'assistant', content: 'late result' });
  await outcome;
  assert.equal(immediate.error?.name, 'AbortError');
  assert.equal(mutations, 0);
});

test('a cancelled permission request cannot grant reusable session approval', async () => {
  const approval = deferred();
  let requests = 0;
  const permissions = new PermissionManager('ask_once_per_session', async () => {
    requests += 1;
    return requests === 1 ? approval.promise : true;
  });
  const controller = new AbortController();
  const pending = permissions.checkPermission('write_workspace_file', { path: 'safe.txt' }, false, controller.signal)
    .then(() => ({ resolved: true }), (error) => ({ error }));
  controller.abort();
  approval.resolve(true);
  assert.equal((await pending).error?.name, 'AbortError');
  assert.equal(await permissions.checkPermission('write_workspace_file', { path: 'safe.txt' }), true);
  assert.equal(requests, 2);
});

test('validation requires permission before any command is started', async () => {
  const engine = new AgentEngine(new ToolRegistry(), new PermissionManager('always_ask', async () => false));
  let commands = 0;
  engine.validationEngine.detectProject = async () => ({ testCommand: 'npm test' });
  engine.validationEngine.runValidation = async () => { commands += 1; };
  await assert.rejects(engine.validateAndRepair({}, 'fixture', [], '', [], { fsPath: process.cwd() }), /not approved/);
  assert.equal(commands, 0);
});

test('cancellation during project detection prevents validation from starting', async () => {
  const inspection = deferred();
  const started = deferred();
  const engine = new AgentEngine(new ToolRegistry(), new PermissionManager('allow_safe_auto'));
  let commands = 0;
  engine.validationEngine.detectProject = async () => { started.resolve(); return inspection.promise; };
  engine.validationEngine.runValidation = async () => { commands += 1; return { passed: true }; };
  const controller = new AbortController();
  const outcome = engine.validateAndRepair({}, 'fixture', [], '', [], { fsPath: process.cwd() }, { signal: controller.signal })
    .then(() => ({ resolved: true }), (error) => ({ error }));
  await started.promise;
  controller.abort();
  inspection.resolve({ testCommand: 'npm test' });
  assert.equal((await outcome).error?.name, 'AbortError');
  assert.equal(commands, 0);
});

test('exhausted validation repairs are reported as failed instead of completed', async () => {
  const registry = new ToolRegistry();
  registry.registerTool(definition, async () => ({ success: true, applied: true, path: 'safe.txt' }), 'edit');
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run project validation', parameters: {} } }, async () => { throw new Error('Validation uses the controlled validation runner'); });
  let approvals = 0;
  const engine = new AgentEngine(registry, new PermissionManager('allow_safe_auto', async (request) => { assert.equal(request.command, 'npm test'); approvals += 1; return true; }));
  engine.validationEngine.detectProject = async () => ({ testCommand: 'npm test' });
  engine.validationEngine.runValidation = async () => ({ command: 'npm test', passed: false, exitCode: 1, stdout: 'failing test', stderr: '', durationMs: 1 });
  const result = await engine.runTask(provider(), 'fixture', [{ role: 'user', content: 'Write a file' }], { mode: 'agent' }, { fsPath: process.cwd() });
  assert.equal(result.validationAttempts.length, 4);
  assert.equal(approvals, 4);
  assert.equal(result.status, 'failed');
  assert.match(result.response, /Verification failed/);
  assert.ok(result.errors.some((error) => error.includes('Verification failed')));
});

test('a replaced task finishing cannot clear the newer task cancellation controller', async () => {
  const engine = Object.create(LocalForgeEngine.prototype);
  engine.sessionManager = { initialize: async () => {} };
  const first = deferred();
  const second = deferred();
  const signals = [];
  engine.executeTaskRun = (signal) => {
    signals.push(signal);
    return signals.length === 1 ? first.promise : second.promise;
  };
  const previous = engine.executeTask('first', 'agent');
  await new Promise((resolve) => setImmediate(resolve));
  const current = engine.executeTask('second', 'agent');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals[0].aborted, true);
  first.resolve({ status: 'cancelled' });
  await previous;
  assert.equal(engine.isBusy(), true);
  engine.cancelCurrentTask();
  assert.equal(signals[1].aborted, true);
  second.resolve({ status: 'cancelled' });
  await current;
  assert.equal(engine.isBusy(), false);
});

test('provider configuration deferred during approved-edit validation reconciles when it finishes', async () => {
  const engine = Object.create(LocalForgeEngine.prototype);
  engine.events = new (require('node:events').EventEmitter)();
  const configurations = [];
  let refreshes = 0;
  let startupChecks = 0;
  engine.ollamaStartupErrors = [];
  engine.ensureLocalOllama = async () => { startupChecks += 1; };
  engine.configuredProviders = { configure: (value) => configurations.push(value), getErrors: () => [] };
  engine.modelRegistry = { refresh: async () => { refreshes += 1; } };
  const pending = deferred();
  engine.applyProposalRun = () => pending.promise;
  const applying = engine.applyProposalAndValidate('fixture');
  await engine.updateProviderConfiguration({ openAiEndpoints: 'http://127.0.0.1:8000/v1' });
  assert.equal(engine.getProviderConfigurationStatus().pending, true);
  assert.equal(configurations.length, 0);
  assert.equal(startupChecks, 0);
  pending.resolve({ success: true });
  await applying;
  assert.equal(engine.getProviderConfigurationStatus().pending, false);
  assert.deepEqual(configurations, [{ openAiEndpoints: 'http://127.0.0.1:8000/v1' }]);
  assert.equal(refreshes, 1);
  assert.equal(startupChecks, 1);
});

test('early task failure releases busy state and review validation remains cancellable', async () => {
  const engine = Object.create(LocalForgeEngine.prototype);
  engine.sessionManager = { initialize: async () => {} };
  engine.executeTaskRun = async () => { throw new Error('early setup failure'); };
  await assert.rejects(engine.executeTask('fail', 'agent'), /early setup failure/);
  assert.equal(engine.isBusy(), false);
  const pending = deferred();
  let signal;
  engine.applyProposalRun = (executionSignal) => { signal = executionSignal; return pending.promise; };
  const applying = engine.applyProposalAndValidate('fixture');
  assert.equal(engine.isBusy(), true);
  await assert.rejects(engine.applyProposalAndValidate('another'), /already running/);
  engine.cancelCurrentTask();
  assert.equal(signal.aborted, true);
  pending.resolve({ success: true });
  await applying;
  assert.equal(engine.isBusy(), false);
});
