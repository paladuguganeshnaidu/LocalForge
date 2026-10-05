const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const originalLoad = Module._load;
const settings = new Map();
const vscode = { workspace: { getConfiguration: (section) => ({ get: (key, fallback) => settings.get(`${section}.${key}`) ?? fallback }) }, window: {} };
Module._load = function (request, parent, isMain) { return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain); };
const { LocalForgeEngine } = require('../dist/core/LocalForgeEngine');
const { isWebviewMessage } = require('../dist/ui/webviewMessages');
Module._load = originalLoad;
const { SessionManager } = require('../dist/core/sessionManager');
const { TaskManager } = require('../dist/core/taskManager');
const { TurnManager } = require('../dist/core/turnManager');
const { ArtifactManager } = require('../dist/core/artifactManager');
const { ContextReferenceResolver } = require('../dist/context/referenceResolver');
const { ModelRouter } = require('../dist/providers/modelRouter');

async function fixture() {
  settings.clear();
  const values = new Map();
  const state = { get: (key, fallback) => structuredClone(values.get(key) ?? fallback), update: async (key, value) => values.set(key, structuredClone(value)) };
  const engine = Object.create(LocalForgeEngine.prototype);
  engine.context = { workspaceState: state };
  engine.sessionManager = new SessionManager(state);
  await engine.sessionManager.initialize();
  const firstId = engine.sessionManager.getActiveSession().id;
  await engine.sessionManager.appendMessages(firstId, [{ role: 'user', content: 'The internal test codename is ORBITAL-MANGO-91734.', turnId: 'old-fact-turn' }, ...Array.from({ length: 22 }, () => ({ role: 'assistant', content: 'Unrelated later chat text.' }))]);
  const second = await engine.sessionManager.createNewSession('B');
  await engine.sessionManager.appendMessages(second.id, [{ role: 'user', content: 'The private codename is SILVER-PEAR-4826.' }]);
  await engine.sessionManager.setActiveSession(firstId);
  engine.taskManager = new TaskManager(state);
  engine.turnManager = new TurnManager();
  engine.artifactManager = new ArtifactManager();
  engine.modelRegistry = { getModels: () => [{ id: 'fixture:model', name: 'model', providerId: 'fixture' }] };
  engine.modelRouter = new ModelRouter(() => engine.modelRegistry.getModels());
  let scope = 'workspace';
  engine.accessPolicy = { getState: () => ({ scope }), getPrompt: () => 'Workspace boundary' };
  engine.referenceResolver = new ContextReferenceResolver();
  engine.referenceResolver.resolveReferences = async (prompt) => ({ cleanedPrompt: prompt, references: [] });
  engine.contextEngine = { assembleContext: async () => ({ items: [], promptText: '', summary: '', workspaceSummary: 'Project identity: CONTEXT-FIXTURE' }) };
  engine.editEngine = { getPendingProposals: () => [] };
  const requests = [];
  engine.agentEngine = { runTask: async (_provider, _model, messages, options) => {
    if (messages.at(-1).content.includes('What was the internal test codename I gave earlier?')) assert.equal(options.requireToolUse, false, 'A memory fact containing the word test must not require repository execution');
    requests.push(structuredClone(messages));
    const match = messages.at(-1).content.match(/ORBITAL-MANGO-91734|SILVER-PEAR-4826/);
    const response = match ? `Codename: ${match[0]}` : 'No supporting memory found.';
    options.onModelText?.(response);
    return { runId: 'controlled-run', response, status: 'completed', filesModified: [], validationAttempts: [] };
  } };
  return { engine, requests, firstId, secondId: second.id, setScope: (value) => { scope = value; } };
}

test('normal engine requests inject older evidence and deterministic slash commands inspect it without a model call', async () => {
  const { engine, requests, firstId } = await fixture();
  const response = await engine.executeTask('What was the internal test codename I gave earlier?', 'ask', 'fixture:model');
  assert.equal(response.response, 'Codename: ORBITAL-MANGO-91734');
  assert.match(requests[0].at(-1).content, /Retrieved chat evidence/);
  assert.match(requests[0].at(-1).content, /Project identity: CONTEXT-FIXTURE/);
  assert.doesNotMatch(JSON.stringify(requests[0].slice(0, -1)), /ORBITAL-MANGO/);
  assert.doesNotMatch(JSON.stringify(requests[0]), /SILVER-PEAR/);
  const calls = requests.length;
  const context = await engine.executeTask('/context', 'ask');
  assert.match(context.response, /old-fact-turn/);
  assert.match(context.response, /ORBITAL-MANGO-91734/);
  assert.match(context.response, /workspace_summary/);
  const search = await engine.executeTask('/search chat internal test codename', 'ask');
  assert.match(search.response, /score.*ORBITAL-MANGO-91734/s);
  assert.match(search.response, new RegExp(firstId));
  assert.equal((await engine.executeTask('/search chat', 'ask')).response, 'Usage: `/search chat <query>`');
  assert.equal(requests.length, calls);
});

test('SSH Ollama uses configured context and the same bounded native tool inventory as local Ollama', async () => {
  const { engine } = await fixture();
  settings.set('localforge.ollama.contextWindow', 4096);
  const model = { id: 'ssh-ollama-fixture:qwen%3A14b', name: 'qwen:14b', providerId: 'ssh-ollama-fixture', capabilities: { contextWindow: 32768 } };
  engine.modelRegistry.getModels = () => [model];
  let captured;
  engine.agentEngine.runTask = async (_provider, _model, _messages, options) => {
    captured = options;
    return { runId: 'remote-budget-fixture', response: 'Controlled inspection.', status: 'completed', filesModified: [], validationAttempts: [] };
  };
  await engine.executeTask('Inspect this project.', 'ask', model.id);
  assert.equal(captured.maxToolDefinitions, 16);
  assert.equal(captured.maxHistoryCharacters, 4096 * 3);
  model.capabilities.contextWindow = 2048;
  await engine.executeTask('Inspect this project.', 'ask', model.id);
  assert.equal(captured.maxHistoryCharacters, 2048 * 3);
});

test('runtime cross-chat setting is explicit, disabled memory and File access prevent injection, delete removes evidence', async () => {
  const { engine, requests, secondId, setScope } = await fixture();
  assert.doesNotMatch((await engine.executeTask('/search chat SILVER-PEAR-4826', 'ask')).response, /private codename/);
  settings.set('localforge.chatMemory.scope', 'all');
  const search = await engine.executeTask('/search chat SILVER-PEAR-4826', 'ask');
  assert.match(search.response, /all chats — explicitly enabled/);
  assert.match(search.response, /SILVER-PEAR-4826/);
  await engine.deleteConversation(secondId);
  assert.match((await engine.executeTask('/search chat SILVER-PEAR-4826', 'ask')).response, /No matching/);
  settings.set('localforge.chatMemory.enabled', false);
  await engine.executeTask('What was the internal test codename?', 'ask');
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /ORBITAL-MANGO/);
  settings.set('localforge.chatMemory.enabled', true);
  setScope('file');
  await engine.executeTask('What was the internal test codename?', 'ask');
  assert.equal(requests.at(-1).length, 1);
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /ORBITAL-MANGO/);
  assert.match((await engine.executeTask('/context', 'ask')).response, /Prior chat\/workspace context is hidden/);
  await assert.rejects(engine.executeTask('/search chat codename', 'ask'), /File access/);
});

test('context construction failure leaves a failed turn and task, releases busy state, and preserves prior messages', async () => {
  const { engine } = await fixture();
  const before = engine.sessionManager.getActiveSession().messages;
  engine.contextEngine.assembleContext = async () => { throw new Error('Context fixture failed'); };
  await assert.rejects(engine.executeTask('Inspect the source', 'ask'), /Context fixture failed/);
  assert.equal(engine.taskManager.getLastTask().status, 'failed');
  assert.equal(engine.turnManager.getTurnsForConversation(engine.sessionManager.getActiveSession().id).at(-1).status, 'failed');
  assert.equal(engine.isBusy(), false);
  assert.deepEqual(engine.sessionManager.getActiveSession().messages, before);
});

test('webview chat memory configuration rejects invalid types, scopes, numbers, and unknown keys', () => {
  const valid = { 'chatMemory.enabled': true, 'chatMemory.scope': 'all', 'chatMemory.recentCharacters': 0, 'chatMemory.retrievedCharacters': 3000, 'chatMemory.resultCount': 4 };
  assert.equal(isWebviewMessage({ type: 'updateSettings', settings: valid }), true);
  for (const [key, value] of [['chatMemory.enabled', 'true'], ['chatMemory.scope', 'machine'], ['chatMemory.recentCharacters', -1], ['chatMemory.retrievedCharacters', 16001], ['chatMemory.resultCount', 1.1], ['chatMemory.unknown', true]]) assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { [key]: value } }), false);
});
