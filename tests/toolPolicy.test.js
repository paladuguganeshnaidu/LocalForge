const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? {} : originalLoad.call(this, request, ...rest); };
const { registerAllCoreTools } = require('../dist/agent/coreTools');
const { registerWorkspaceTools } = require('../dist/agent/workspaceTools');
const { registerExternalTools } = require('../dist/agent/externalTools');
const { registerWorkflowTools } = require('../dist/agent/workflowTools');
const { registerSubagentTools } = require('../dist/agent/subagentTools');
const { BROWSER_TOOL_DEFINITION } = require('../dist/browser/browserTool');
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { AgentAccessPolicy } = require('../dist/agent/accessPolicy');
const { getBuiltinToolDescriptors, getBuiltinToolDescriptor, freezeToolDescriptor } = require('../dist/agent/toolPolicy');

function fixture(handler = async () => ({ success: true })) {
  const registry = new ToolRegistry();
  registerWorkspaceTools(registry, () => ({}));
  registerAllCoreTools(registry, { editEngine: {} });
  registerExternalTools(registry);
  const permissions = new PermissionManager();
  registerWorkflowTools(registry, permissions);
  registerSubagentTools(registry, permissions, {}, () => undefined, () => {});
  registry.registerTool(BROWSER_TOOL_DEFINITION, handler);
  for (const tool of registry.getAllTools()) registry.replaceTool(tool.definition, handler, undefined, tool.source);
  registry.assertInvariants();
  return registry;
}

function argumentsFor(descriptor) {
  const args = { command: 'npm test', url: 'https://example.test/docs', recoveryId: 'fixture-recovery', action: 'open' };
  for (const key of descriptor.pathArguments) args[key] = key === 'paths' || key === 'files' ? ['selected.txt'] : 'selected.txt';
  return args;
}

test('real built-in registration is unique, complete and uses the same canonical policies as permission classification', () => {
  const registry = fixture();
  const descriptors = getBuiltinToolDescriptors();
  assert.deepEqual(registry.getAllTools().map((tool) => tool.name).sort(), descriptors.map((policy) => policy.name).sort());
  const permissions = new PermissionManager();
  for (const tool of registry.getAllTools()) {
    assert.deepEqual(tool.descriptor, getBuiltinToolDescriptor(tool.name));
    assert.equal(permissions.classifyTool(tool.name), tool.category);
    assert.ok(Object.isFrozen(tool.descriptor));
    assert.ok(Object.isFrozen(tool.descriptor.scopes));
    assert.ok(tool.definition.function.description);
    assert.equal(tool.definition.function.parameters.type, 'object');
  }
});

test('duplicate registration throws; explicit replacement validates before replacing the existing handler', async () => {
  const registry = new ToolRegistry();
  const definition = { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } };
  registry.registerTool(definition, async () => 'original');
  assert.throws(() => registry.registerTool(definition, async () => 'hidden replacement'), /Duplicate/);
  assert.throws(() => registry.replaceTool({ ...definition, function: { ...definition.function, description: '' } }, async () => 'broken'), /description/);
  assert.equal(await registry.executeTool('read_file', {}), 'original');
  registry.replaceTool(definition, async () => 'explicit replacement');
  assert.equal(await registry.executeTool('read_file', {}), 'explicit replacement');
  assert.equal(registry.getAllTools().length, 1);
});

test('unknown names cannot gain auto-approval from read prefixes or a caller-supplied trusted-read flag', async () => {
  const registry = new ToolRegistry();
  let dispatches = 0;
  registry.registerTool({ type: 'function', function: { name: 'read_unknown_plugin', description: 'Unknown plugin', parameters: {} } }, async () => { dispatches += 1; });
  for (const mode of ['request_review', 'allow_safe_auto', 'always_proceed', 'ask_once_per_session', 'always_ask']) {
    const denied = new PermissionManager(mode, async () => false);
    assert.equal(await denied.checkPermission('read_unregistered', {}, true), false);
    await assert.rejects(registry.executeTool('read_unknown_plugin', {}, denied), /rejected/);
  }
  await assert.rejects(registry.executeTool('read_unknown_plugin', {}), /permission manager/);
  await assert.rejects(registry.executeTool('read_unregistered', {}), /registered/);
  assert.equal(dispatches, 0);
  await registry.executeTool('read_unknown_plugin', {}, new PermissionManager('always_ask', async () => true));
  assert.equal(dispatches, 1);
  assert.throws(() => registry.registerTool({ type: 'function', function: { name: 'read_file', description: 'Hijacked builtin', parameters: {} } }, async () => {}, { source: 'mcp' }), /reserved built-in/);
});

test('replacing a handler invalidates cached session approval for that registration', async () => {
  const registry = new ToolRegistry();
  const definition = { type: 'function', function: { name: 'run_command', description: 'Run', parameters: {} } };
  let requests = 0;
  const permissions = new PermissionManager('ask_once_per_session', async () => { requests += 1; return true; });
  registry.registerTool(definition, async () => 'original');
  await registry.executeTool('run_command', { command: 'npm test' }, permissions);
  await registry.executeTool('run_command', { command: 'npm test' }, permissions);
  registry.replaceTool(definition, async () => 'replacement');
  await registry.executeTool('run_command', { command: 'npm test' }, permissions);
  assert.equal(requests, 2);
});

test('subagent registries retain validators, redaction, timeout, provenance and live scope boundaries', async () => {
  const registry = new ToolRegistry();
  const access = new AgentAccessPolicy();
  registry.setAccessPolicy(access);
  const definition = { type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } };
  registry.registerTool(definition, async () => ({ visible: 'safe', credential: 'PRIVATE' }), {
    validate: (args) => { if (args.invalid) throw new Error('Invalid fixture arguments'); },
    redact: (result) => ({ visible: result.visible }), timeout: 100
  });
  const scoped = registry.createScopedRegistry(['read']);
  assert.strictEqual(scoped.getTool('read_file'), registry.getTool('read_file'));
  assert.deepEqual(await scoped.executeTool('read_file', { path: 'selected.txt' }), { visible: 'safe' });
  await assert.rejects(scoped.executeTool('read_file', { invalid: true }), /Invalid fixture/);
  access.setScope('file', 'selected.txt');
  await assert.rejects(scoped.executeTool('read_file', { path: 'other.txt' }), /restricted/);
  assert.equal(scoped.getTool('read_file').timeout, 100);
  assert.equal(scoped.getTool('read_file').source, 'builtin');
});

test('an explicitly strengthened read policy requires approval without a separate classification override', async () => {
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'read_file', description: 'Explicitly approved read', parameters: {} } }, async () => 'approved', { permissionRequired: true });
  const tool = registry.getTool('read_file');
  assert.equal(tool.descriptor.approval, 'explicit');
  await assert.rejects(registry.executeTool('read_file', {}), /permission manager/);
  let approvals = 0;
  const permissions = new PermissionManager('always_proceed', async (request) => { approvals += 1; assert.equal(request.policy.approval, 'explicit'); return false; });
  await assert.rejects(registry.executeTool('read_file', {}, permissions), /rejected/);
  assert.equal(approvals, 1);
});

test('invalid or weakened capability descriptors fail closed', () => {
  const processPolicy = getBuiltinToolDescriptor('run_command');
  for (const change of [{ approval: 'read_only' }, { scopes: [] }, { scopes: ['admin'] }, { network: 'yes' }, { pathArguments: [0] }, { category: 'unknown' }]) {
    assert.throws(() => freezeToolDescriptor({ ...processPolicy, ...change }));
  }
  const registry = new ToolRegistry();
  assert.throws(() => registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run', parameters: {} } }, async () => {}, { descriptor: { ...processPolicy, processExecution: false } }), /cannot be replaced/);
});

test('every real tool × permission mode × access scope honors dispatch and approval decisions', async () => {
  let cases = 0;
  const modes = ['request_review', 'allow_safe_auto', 'always_proceed', 'ask_once_per_session', 'always_ask'];
  for (const tool of fixture().getAllTools()) for (const mode of modes) for (const scope of ['file', 'workspace', 'machine']) for (const decision of [false, true]) {
    let dispatches = 0;
    const requests = [];
    const registry = fixture(async () => { dispatches += 1; return { success: true }; });
    const access = new AgentAccessPolicy(); access.setScope(scope, scope === 'file' ? 'selected.txt' : undefined);
    registry.setAccessPolicy(access);
    const permissions = new PermissionManager(mode, async (request) => { requests.push(request); return decision; });
    permissions.setAccessPolicy(access);
    const reachable = tool.descriptor.scopes.includes(scope);
    const approvalRequired = tool.descriptor.approval === 'explicit' || tool.descriptor.approval === 'review' && !['request_review', 'allow_safe_auto', 'always_proceed'].includes(mode);
    const allowed = reachable && (!approvalRequired || decision);
    if (allowed) await registry.executeTool(tool.name, argumentsFor(tool.descriptor), permissions);
    else await assert.rejects(registry.executeTool(tool.name, argumentsFor(tool.descriptor), permissions), reachable ? /rejected/ : /unavailable/);
    assert.equal(dispatches, allowed ? 1 : 0, tool.name + '/' + mode + '/' + scope);
    assert.equal(requests.length, reachable && approvalRequired ? 1 : 0);
    for (const request of requests) { assert.deepEqual(request.policy, tool.descriptor); assert.equal(request.category, tool.category); }
    cases += 1;
  }
  console.log('[ToolPolicyTable] ' + cases + ' cases passed with both approve/deny decisions.');
});

test('dynamic ordered pairs and triples exercise actual registry/policy/permission/dispatch/cancellation/error boundaries', async () => {
  let dispatched = 0;
  const registry = fixture(async (args, context) => { context.signal.throwIfAborted(); if (args.fixtureFailure) throw new Error('Controlled dispatch failure'); dispatched += 1; return { success: true }; });
  const tools = registry.getAllTools();
  const access = new AgentAccessPolicy(); registry.setAccessPolicy(access);
  const requests = [];
  const evidence = [];
  let approved = true;
  const permissions = new PermissionManager('always_ask', async (request) => { requests.push(request); return approved; }); permissions.setAccessPolicy(access);
  let combinations = 0;
  const exercise = async (sequence) => {
    for (const [position, tool] of sequence.entries()) {
      const scopes = ['workspace', 'file', 'machine'];
      const scope = scopes[(combinations + position) % scopes.length]; access.setScope(scope, scope === 'file' ? 'selected.txt' : undefined);
      approved = (combinations + position) % 4 !== 0;
      const controller = new AbortController();
      const cancelled = (combinations + position) % 7 === 0;
      if (cancelled) controller.abort();
      const args = { ...argumentsFor(tool.descriptor), fixtureFailure: (combinations + position) % 11 === 0 };
      const before = dispatched;
      const requestsBefore = requests.length;
      const allowed = !cancelled && tool.descriptor.scopes.includes(scope) && (tool.descriptor.approval === 'read_only' || approved);
      const succeeds = allowed && !args.fixtureFailure;
      if (succeeds) await registry.executeTool(tool.name, args, permissions, { signal: controller.signal });
      else await assert.rejects(registry.executeTool(tool.name, args, permissions, { signal: controller.signal }), cancelled ? { name: 'AbortError' } : !tool.descriptor.scopes.includes(scope) ? /unavailable/ : !allowed ? /rejected/ : /Controlled dispatch failure/);
      assert.equal(dispatched - before, succeeds ? 1 : 0);
      if (cancelled || !tool.descriptor.scopes.includes(scope)) assert.equal(requests.length, requestsBefore);
      evidence.push({ combination: combinations, sequence: sequence.map((entry) => entry.name), position, tool: tool.name, category: tool.category, scope, allowed, cancelled, handlerFailure: args.fixtureFailure, dispatched: dispatched - before, approvals: requests.length - requestsBefore, stateViolation: false, unexpectedException: false });
    }
    combinations += 1;
  };
  for (const first of tools) for (const second of tools) await exercise([first, second]);
  const pairs = combinations;
  for (const first of tools) for (const second of tools) for (const third of tools) await exercise([first, second, third]);
  assert.equal(pairs, tools.length ** 2);
  assert.equal(combinations - pairs, tools.length ** 3);
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const output = path.join(os.tmpdir(), 'localforge-tool-policy-interactions.json');
  fs.writeFileSync(output, JSON.stringify({ tools: tools.map((tool) => ({ name: tool.name, descriptor: tool.descriptor })), pairs, triples: combinations - pairs, evidence }));
  console.log('[ToolInteractions] Evidence: ' + output);
  console.log('[ToolInteractions] N=' + tools.length + '; ordered pairs=' + pairs + '; ordered triples=' + (combinations - pairs) + '. Controlled handlers verify plumbing, not feature semantics.');
});
