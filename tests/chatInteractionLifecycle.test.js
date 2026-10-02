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
  const context = { workspaceState: { get: () => undefined, update: async () => {} } };
  const view = new LocalForgeViewProvider({}, context, engine);
  const messages = [];
  view.post = (message) => messages.push(message);
  const previous = view.handleChatMessage({ model: 'fixture', prompt: 'First task' });
  const current = view.handleChatMessage({ model: 'fixture', prompt: 'Second task' });
  const startedAt = messages.length;
  callbacks[0].onToken('stale token');
  callbacks[0].onProgress('stale progress');
  first.reject(new DOMException('Cancelled', 'AbortError'));
  await previous;
  assert.equal(cancellations, 1);
  assert.equal(view.busy, true);
  assert.equal(messages.slice(startedAt).some((message) => message.type === 'status' && message.state === 'ready'), false);
  assert.equal(messages.some((message) => message.content === 'stale token' || message.message === 'stale progress'), false);
  second.resolve({ response: 'Second completed', errors: [], status: 'completed' });
  await current;
  assert.equal(view.busy, false);
  assert.deepEqual(view.conversations.get('fixture').map((message) => message.content), ['Second task', 'Second completed']);
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
  const current = view.handleChatMessage({ model: 'fixture', prompt: 'Second task' });
  callbacks[0]('stale token');
  first.resolve();
  await previous;
  assert.equal(view.busy, true);
  assert.equal(messages.some((message) => message.content === 'stale token' || message.type === 'done'), false);
  callbacks[1]('current answer');
  second.resolve();
  await current;
  assert.deepEqual(view.conversations.get('fixture').map((message) => message.content), ['Second task', 'current answer']);
});
