const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, window: {} };
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.apply(this, arguments);
};
const { LocalForgeViewProvider } = require('../dist/ui/chatView.js');
Module._load = originalLoad;
const { isWebviewMessage } = require('../dist/ui/webviewMessages.js');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { EventEmitter } = require('node:events');

test('remote disconnect clears chat status without cancellation and late GPU status cannot overwrite it', async () => {
  let releaseProbe;
  const pendingProbe = new Promise(resolve => { releaseProbe = resolve; });
  const events = new EventEmitter();
  let cancellations = 0;
  const engine = { events, sessionManager: {}, permissionManager: { setApprovalHandler() {} }, cancelCurrentTask: () => { cancellations += 1; } };
  const view = new LocalForgeViewProvider({}, { subscriptions: [], workspaceState: {} }, engine);
  const posts = [];
  view.post = message => posts.push(message);
  const tunnel = { isConnected: true, getGpuStatus: () => pendingProbe };
  view.setRemoteSession({ tunnel, providerId: 'ssh-fixture', profileName: 'Owned fixture' });
  tunnel.isConnected = false;
  events.emit('remoteDisconnected', new Error('SSH connection closed; reconnect.'));
  assert.deepEqual(posts.find(message => message.type === 'remoteStatus'), { type: 'remoteStatus', connected: false });
  assert.ok(posts.some(message => message.type === 'controlError' && /reconnect/.test(message.message)));
  releaseProbe('STALE_GPU_STATUS');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(posts.some(message => message.type === 'remoteStatus' && message.connected), false);
  assert.equal(cancellations, 0);
});

test('all approval decisions settle without cancellation even if updating the activity history throws', async () => {
  for (const decision of ['allow', 'deny', 'allow_session']) {
    const controller = new AbortController();
    const posts = [];
    let cancellations = 0;
    const permissions = new PermissionManager('always_ask');
    const registry = new ToolRegistry();
    registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Actual registered command fixture', parameters: {} } }, async () => ({ exitCode: 0 }));
    const engine = {
      permissionManager: permissions, toolRegistry: registry, accessPolicy: { getState: () => ({ scope: 'workspace' }) },
      sessionManager: { getActiveSession: () => ({ id: 'chat' }) },
      turnManager: { getTurnsForConversation: () => [{ turnId: 'turn', status: 'running' }], addActivity: () => ({ id: 'approval' }), getTurn: () => ({ turnId: 'turn', activities: [{ id: 'approval', timestamp: Date.now() }] }), updateActivity: () => { throw new Error('Controlled trace storage failure'); } },
      cancelCurrentTask: () => { cancellations += 1; }
    };
    const view = new LocalForgeViewProvider({}, { subscriptions: [], workspaceState: {}, globalState: { update: async () => {} } }, engine);
    view.post = message => posts.push(message);
    const tool = registry.getTool('run_command');
    const pending = permissions.checkPermission('run_command', { command: 'node --test actual.test.cjs' }, false, controller.signal, true, tool.descriptor, tool.authorizationId);
    const request = posts.find(message => message.type === 'permissionRequest').request;
    view.resolvePermissionRequest(request.id, decision);
    const allowed = await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('Approval never settled')), 100))]);
    assert.equal(allowed, decision !== 'deny');
    assert.equal(controller.signal.aborted, false);
    assert.equal(cancellations, 0);
    assert.equal(view.pendingPermissionRequests.size, 0);
    assert.ok(posts.some(message => message.type === 'permissionDecision' && message.requestId === request.id && message.decision === decision));
    assert.equal(permissions.hasWorkspaceSessionApproval(), decision === 'allow_session');
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test('a replaced chat cannot clear newer busy state, emit stale text or overwrite its completion', async () => {
  const first = deferred();
  const second = deferred();
  const callbacks = [];
  let cancellations = 0;
  const engine = {
    permissionManager: { setApprovalHandler: () => {} },
    cancelCurrentTask: () => { cancellations += 1; },
    editEngine: { getPendingProposals: () => [], getRecoveryHistory: () => [] },
    executeTask: (_prompt, _mode, _model, options) => { callbacks.push(options); return callbacks.length === 1 ? first.promise : second.promise; }
  };
  const context = { subscriptions: [], workspaceState: { get: () => undefined, update: async () => {} } };
  const view = new LocalForgeViewProvider({}, context, engine);
  const messages = [];
  view.post = (message) => messages.push(message);
  const previous = view.handleChatMessage({ model: 'fixture', prompt: 'First task' });
  await new Promise((resolve) => setImmediate(resolve));
  const current = view.handleChatMessage({ model: 'fixture', prompt: 'Second task' });
  await new Promise((resolve) => setImmediate(resolve));
  const startedAt = messages.length;
  callbacks[0].onToken('stale token');
  callbacks[0].onProgress('stale progress');
  callbacks[0].onActivity({ title: 'stale activity' });
  callbacks[0].onArtifact({ title: 'stale artifact' });
  first.reject(new DOMException('Cancelled', 'AbortError'));
  await previous;
  assert.equal(cancellations, 1);
  assert.equal(view.busy, true);
  assert.equal(messages.slice(startedAt).some((message) => message.type === 'status' && message.state === 'ready'), false);
  assert.equal(messages.some((message) => message.content === 'stale token' || message.message === 'stale progress'), false);
  assert.equal(messages.some((message) => message.activity?.title === 'stale activity' || message.artifact?.title === 'stale artifact'), false);
  second.resolve({ response: 'Second completed', errors: [], status: 'completed' });
  await current;
  assert.equal(view.busy, false);
  assert.deepEqual(view.sessionManager.getActiveSession().messages.map((message) => message.content), ['Second task', 'Second completed']);
});

test('standalone stop invalidates a provider that ignores cancellation and completes late', async () => {
  const pending = deferred();
  let onToken;
  const view = new LocalForgeViewProvider({ streamChat: (_model, _messages, callback) => { onToken = callback; return pending.promise; } }, { workspaceState: { get: () => undefined, update: async () => {} } });
  const messages = [];
  view.post = (message) => messages.push(message);
  const running = view.handleChatMessage({ model: 'fixture', prompt: 'Run a task' });
  await new Promise((resolve) => setImmediate(resolve));
  view.cancelActiveChat();
  const stoppedAt = messages.length;
  onToken('late response');
  pending.resolve();
  await running;
  assert.equal(view.busy, false);
  assert.equal(messages.slice(stoppedAt).some((message) => ['chunk', 'done', 'error'].includes(message.type)), false);
  assert.deepEqual(view.sessionManager.getActiveSession().messages, []);
});

test('rollback IPC rejects malformed IDs, traversal and ambiguous file selections', () => {
  const recoveryId = 'undo-01234567-89ab-4cde-8fab-0123456789ab';
  assert.equal(isWebviewMessage({ type: 'rollbackEdit', recoveryId }), true);
  assert.equal(isWebviewMessage({ type: 'rollbackEdit', recoveryId, files: ['src/safe.ts'] }), true);
  assert.equal(isWebviewMessage({ type: 'rollbackEdit', recoveryId: '../outside' }), false);
  for (const files of [[], ['../outside'], 'src/safe.ts', [42]]) {
    assert.equal(isWebviewMessage({ type: 'rollbackEdit', recoveryId, files }), false);
    assert.equal(isWebviewMessage({ type: 'applyEdit', proposalId: 'fixture', files }), false);
  }
  assert.equal(isWebviewMessage({ type: 'forgetEditRecovery', recoveryId }), true);
});

test('fallback provider chat also discards late tokens and completions from replaced requests', async () => {
  const first = deferred();
  const second = deferred();
  const callbacks = [];
  const provider = { streamChat: (_model, _messages, onToken) => {
    callbacks.push(onToken);
    return callbacks.length === 1 ? first.promise : second.promise;
  } };
  const context = { workspaceState: { get: () => undefined, update: async () => {} } };
  const view = new LocalForgeViewProvider(provider, context);
  const messages = [];
  view.post = (message) => messages.push(message);
  const previous = view.handleChatMessage({ model: 'fixture', prompt: 'First task' });
  await new Promise((resolve) => setImmediate(resolve));
  const current = view.handleChatMessage({ model: 'fixture', prompt: 'Second task' });
  await new Promise((resolve) => setImmediate(resolve));
  callbacks[0]('stale token');
  first.resolve();
  await previous;
  assert.equal(view.busy, true);
  assert.equal(messages.some((message) => message.content === 'stale token' || message.type === 'done'), false);
  callbacks[1]('current answer');
  second.resolve();
  await current;
  assert.deepEqual(view.sessionManager.getActiveSession().messages.map((message) => message.content), ['Second task', 'current answer']);
});
