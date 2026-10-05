const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const vscode = { workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) }, window: {} };
Module._load = function (request, parent, isMain) {
  return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
};
const { LocalForgeEngine } = require('../dist/core/LocalForgeEngine');
const { LocalForgeViewProvider } = require('../dist/ui/chatView');
Module._load = originalLoad;
const { SessionManager } = require('../dist/core/sessionManager');
const { TaskManager } = require('../dist/core/taskManager');
const { TurnManager } = require('../dist/core/turnManager');
const { ArtifactManager } = require('../dist/core/artifactManager');
const { classifyTaskIntent, requiresWorkspaceToolUse } = require('../dist/agent/taskIntent');
const { ModelRouter } = require('../dist/providers/modelRouter');

async function fixture(streamChat) {
  const values = new Map();
  const storage = { get: (key, fallback) => structuredClone(values.get(key) ?? fallback), update: async (key, value) => values.set(key, structuredClone(value)) };
  const engine = Object.create(LocalForgeEngine.prototype);
  engine.context = { workspaceState: storage };
  engine.sessionManager = new SessionManager(storage);
  await engine.sessionManager.initialize();
  await engine.sessionManager.appendMessages(engine.sessionManager.getActiveSession().id, [
    { role: 'user', content: 'The workspace is Clinch Works, a learning portal.' },
    { role: 'assistant', content: 'Welcome to Clinch Works. PRIVATE_PRIOR_PROJECT_DATA' }
  ]);
  engine.taskManager = new TaskManager(storage);
  engine.turnManager = new TurnManager();
  engine.artifactManager = new ArtifactManager();
  engine.modelRegistry = { getModels: () => [{ id: 'fixture:model', name: 'model', providerId: 'fixture' }] };
  engine.modelRouter = new ModelRouter(() => engine.modelRegistry.getModels());
  engine.accessPolicy = { getState: () => ({ scope: 'workspace' }), getPrompt: () => 'WORKSPACE_BOUNDARY' };
  engine.referenceResolver = { parseSlashCommand: (prompt) => ({ cleanPrompt: prompt }), resolveReferences: async () => assert.fail('A greeting must not resolve project references') };
  engine.contextEngine = { assembleContext: async () => assert.fail('A greeting must not inspect project context') };
  engine.agentEngine = { runTask: async () => assert.fail('A greeting must not enter the tool loop') };
  engine.editEngine = { getPendingProposals: () => [{ id: 'unrelated-pending-change' }] };
  engine.compositeProvider = { streamChat };
  return engine;
}

test('pure conversation intent does not swallow actual coding tasks or explicit references', () => {
  for (const prompt of ['hello', ' Hello! ', 'thanks', 'good morning']) assert.equal(classifyTaskIntent(prompt), 'conversation');
  for (const prompt of ['hello, read README.md', 'hello @file:src/index.ts', 'thanks, now fix the bug', 'create a portfolio', '/search hello']) assert.notEqual(classifyTaskIntent(prompt), 'conversation');
  assert.equal(classifyTaskIntent('read all project and say the summary'), 'inspection');
  assert.equal(classifyTaskIntent('What was the internal test codename I gave earlier?'), 'memory');
  assert.equal(requiresWorkspaceToolUse('What was the internal test codename I gave earlier?'), false);
  assert.equal(requiresWorkspaceToolUse('run the test I mentioned earlier'), true);
  assert.equal(requiresWorkspaceToolUse('read the file I mentioned earlier'), true);
  assert.equal(requiresWorkspaceToolUse('read all project and say the summary'), true);
});

test('real engine greeting routing streams without workspace, past messages, tools or plan artifacts', async () => {
  for (const mode of ['ask', 'plan', 'agent']) {
    let calls = 0;
    const tokens = [];
    const engine = await fixture(async (model, messages, onToken, signal) => {
      calls += 1;
      assert.equal(model, 'fixture:model');
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, 'system');
      assert.equal(messages[1].content, 'hello');
      assert.doesNotMatch(JSON.stringify(messages), /Clinch|PRIVATE_PRIOR|WORKSPACE_BOUNDARY/);
      assert.ok(signal instanceof AbortSignal);
      onToken('Hello! ');
      onToken('What would you like to build?');
    });
    const result = await engine.executeTask('hello', mode, 'fixture:model', { onToken: (token) => tokens.push(token) });
    assert.equal(calls, 1);
    assert.equal(result.response, tokens.join(''));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesModified, []);
    const session = engine.sessionManager.getActiveSession();
    assert.equal(session.messages.length, 4);
    assert.equal(session.messages.at(-1).model, 'fixture:model');
    assert.equal(session.messages.at(-1).providerId, 'fixture');
    assert.equal(engine.artifactManager.getArtifactsByConversation(session.id).length, 0);
    assert.equal(engine.turnManager.getTurnsForConversation(session.id)[0].status, 'completed');
    assert.equal(engine.taskManager.getLastTask().status, 'completed');
    assert.equal(engine.isBusy(), false);
    assert.match(session.lastContextPreview, /current message only/);
  }
});

test('cancelled or empty conversational streams do not save a false successful answer', async () => {
  let capturedSignal;
  let lateToken;
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const engine = await fixture(async (_model, _messages, onToken, signal) => {
    capturedSignal = signal;
    lateToken = onToken;
    await pending;
  });
  const tokens = [];
  const running = engine.executeTask('hello', 'agent', 'fixture:model', { onToken: (token) => tokens.push(token) });
  await new Promise((resolve) => setImmediate(resolve));
  engine.cancelCurrentTask();
  assert.equal(capturedSignal.aborted, true);
  lateToken('Must not be visible');
  finish();
  await assert.rejects(running, (error) => error.name === 'AbortError');
  assert.deepEqual(tokens, []);
  assert.equal(engine.sessionManager.getActiveSession().messages.length, 2);
  assert.equal(engine.taskManager.getLastTask().status, 'cancelled');
  const empty = await fixture(async () => {});
  await assert.rejects(empty.executeTask('hello', 'ask'), /empty response/);
  assert.equal(empty.taskManager.getLastTask().status, 'failed');
  assert.equal(empty.isBusy(), false);
});

test('a missing selected provider fails visibly without sending project data to a fallback or changing chat history', async () => {
  const engine = await fixture(async () => assert.fail('No fallback provider may receive this request'));
  engine.modelRouter = new ModelRouter(() => engine.modelRegistry.getModels());
  const before = engine.sessionManager.getActiveSession();
  await assert.rejects(engine.executeTask('hello', 'agent', 'removed-provider:model'), /unavailable.*chat is preserved/);
  assert.deepEqual(engine.sessionManager.getActiveSession(), before);
  assert.equal(engine.isBusy(), false);
  assert.equal(engine.taskManager.getTasks().length, 0);
});

test('fallback streaming greeting omits old project history, while a coding question retains it', async () => {
  const requests = [];
  const storage = { get: () => undefined, update: async () => {} };
  const view = new LocalForgeViewProvider({ streamChat: async (_model, messages, onToken) => { requests.push(messages); onToken('Response'); } }, { workspaceState: storage });
  view.post = () => {};
  await view.sessionManager.initialize();
  await view.sessionManager.appendMessages(view.sessionManager.getActiveSession().id, [{ role: 'assistant', content: 'PRIVATE_PRIOR_PROJECT_DATA Clinch Works' }]);
  await view.handleChatMessage({ model: 'fixture', prompt: 'hello' });
  assert.equal(requests[0].length, 2);
  assert.doesNotMatch(JSON.stringify(requests[0]), /Clinch|PRIVATE_PRIOR/);
  await view.handleChatMessage({ model: 'fixture', prompt: 'Explain that implementation' });
  assert.match(JSON.stringify(requests[1]), /PRIVATE_PRIOR_PROJECT_DATA/);
});

test('clear and delete purge only their own activities and artifacts while preserving file recovery', async () => {
  const engine = await fixture(async (_model, _messages, onToken) => onToken('Hello!'));
  const first = engine.sessionManager.getActiveSession();
  const second = await engine.sessionManager.createNewSession('B');
  engine.artifactManager.createArtifact({ type: 'Test Report', title: 'A report', content: 'A', conversationId: first.id });
  engine.artifactManager.createArtifact({ type: 'Test Report', title: 'B report', content: 'B', conversationId: second.id });
  for (const session of [first, second]) {
    const turn = engine.turnManager.startTurn({ conversationId: session.id, historyEpoch: session.historyEpoch, modelId: 'fixture', mode: 'ask', strategy: 'fast' });
    engine.turnManager.addActivity(turn.turnId, { category: 'Reading', title: session.id, status: 'success' });
    engine.turnManager.completeTurn(turn.turnId);
  }
  let recoveryTouched = false;
  engine.editEngine = new Proxy({}, { get: () => { recoveryTouched = true; assert.fail('Chat cleanup must not alter workspace edits or recovery'); } });
  const staleTrace = engine.turnManager.getPersistedHistory();
  await engine.clearConversation(first.id);
  assert.equal(engine.sessionManager.getSessions().find((session) => session.id === first.id).messages.length, 0);
  assert.deepEqual(engine.getActivityHistory(first.id), []);
  assert.equal(engine.artifactManager.getArtifactsByConversation(first.id).length, 0);
  assert.equal(engine.artifactManager.getArtifactsByConversation(second.id).length, 1);
  engine.turnManager.restorePersistedHistory(staleTrace);
  await engine.initializeConversationHistory();
  assert.deepEqual(engine.getActivityHistory(first.id), []);
  assert.equal(engine.getActivityHistory(second.id).length, 1);
  await engine.sessionManager.setActiveSession(first.id);
  await engine.executeTask('hello', 'ask');
  assert.equal(engine.getActivityHistory(first.id).length, 1, 'New turns belong to the new cleared-chat epoch');
  await engine.deleteConversation(first.id);
  assert.deepEqual(engine.getActivityHistory(first.id), []);
  assert.equal(engine.artifactManager.getArtifactsByConversation(second.id).length, 1);
  assert.equal(recoveryTouched, false);
});
