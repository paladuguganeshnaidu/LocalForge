const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SessionManager } = require('../dist/core/sessionManager');
const { ChatMemoryIndex, sanitizeContext, readChatMemoryOptions, recentChatMessages } = require('../dist/context/chatMemory');
const { composeRequestContext, formatRequestContext } = require('../dist/context/requestContext');

function storage() {
  const values = new Map();
  return { get: (key, fallback) => structuredClone(values.get(key) ?? fallback), update: async (key, value) => values.set(key, structuredClone(value)) };
}

async function seededStore(directory) {
  const state = storage();
  const store = new SessionManager(state, directory);
  await store.initialize();
  const first = store.getActiveSession();
  await store.appendMessages(first.id, [{ role: 'user', content: 'The internal test codename is ORBITAL-MANGO-91734.', turnId: 'turn-supporting-fact' }]);
  await store.appendMessages(first.id, Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Later unrelated discussion number ${index}.` })));
  const second = await store.createNewSession('Private B');
  await store.appendMessages(second.id, [{ role: 'user', content: 'The private lunar codename is SILVER-PEAR-4826.' }]);
  await store.setActiveSession(first.id);
  return { store, state, first, second };
}

const defaults = readChatMemoryOptions((_key, fallback) => fallback);

test('BM25 retrieves old supporting turns, excludes recent duplicates, and defaults to current-chat privacy', async () => {
  const { store, first, second } = await seededStore();
  const memory = new ChatMemoryIndex(store);
  const recent = recentChatMessages(store.getActiveSession(), 6000);
  assert.doesNotMatch(JSON.stringify(recent), /ORBITAL-MANGO/);
  const matches = await memory.search('What was the internal test codename I gave earlier?', first.id, { excludeMessageIds: new Set(recent.map((message) => message.id)) });
  assert.match(matches[0].text, /ORBITAL-MANGO-91734/);
  assert.equal(matches[0].turnId, 'turn-supporting-fact');
  assert.equal(matches[0].messageId, store.getActiveSession().messages[0].id);
  assert.ok(matches[0].score > 0);
  assert.deepEqual(await memory.search('SILVER-PEAR-4826', first.id), []);
  assert.equal((await memory.search('SILVER-PEAR-4826', first.id, { scope: 'all' }))[0].chatId, second.id);
  assert.deepEqual(await memory.search('', first.id), []);
  assert.deepEqual(await memory.search('%%%[]{}`', first.id), []);
  assert.deepEqual(await memory.search('ORBITAL-MANGO', first.id, { maximumCharacters: 0 }), []);
});

test('clearing, deletion, restart, and a concurrent delete cannot resurrect derived chat knowledge', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-memory-'));
  try {
    const { store, state, first, second } = await seededStore(directory);
    const restarted = new SessionManager(state, directory);
    await restarted.initialize();
    const index = new ChatMemoryIndex(restarted);
    assert.match((await index.search('internal test codename', first.id))[0].text, /ORBITAL/);
    await restarted.clearSession(first.id);
    assert.deepEqual(await index.search('internal test codename', first.id), []);
    await restarted.deleteSession(second.id);
    assert.deepEqual(await index.search('SILVER-PEAR-4826', first.id, { scope: 'all' }), []);
    const later = new SessionManager(state, directory);
    await later.initialize();
    assert.deepEqual(await new ChatMemoryIndex(later).search('ORBITAL-MANGO-91734 SILVER-PEAR-4826', first.id, { scope: 'all' }), []);
    await store.appendMessages(first.id, Array.from({ length: 250 }, () => ({ role: 'user', content: 'concurrent unique memory' })));
    const deletingIndex = new ChatMemoryIndex(store);
    const searching = deletingIndex.search('concurrent unique memory', first.id);
    await store.deleteSession(first.id);
    assert.deepEqual(await searching, []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('known credential patterns and raw tool or oversized output are excluded without altering originals', async () => {
  const store = new SessionManager(storage());
  await store.initialize();
  const session = store.getActiveSession();
  const original = 'Deployment region NORTH-STAR. API_KEY=SECRET_NEVER_SEND password: hunter-private Authorization: Bearer bearer-private';
  await store.appendMessages(session.id, [
    { role: 'user', content: original },
    { role: 'tool', content: 'RAW_TERMINAL_DUMP' },
    { role: 'assistant', content: 'RAW_TOOL_CALL', tool_calls: [{ id: 'call', type: 'function', function: { name: 'run_command', arguments: '{}' } }] },
    { role: 'assistant', content: `ENVIRONMENT_DUMP ${'x'.repeat(9000)}` },
    { role: 'user', content: 'BINARY\0PRIVATE' }
  ]);
  const index = new ChatMemoryIndex(store);
  const safe = await index.search('Deployment region', session.id);
  assert.match(safe[0].text, /NORTH-STAR/);
  assert.doesNotMatch(safe[0].text, /SECRET_NEVER_SEND|hunter-private|bearer-private/);
  for (const query of ['SECRET_NEVER_SEND', 'hunter-private', 'bearer-private', 'RAW_TERMINAL_DUMP', 'RAW_TOOL_CALL', 'ENVIRONMENT_DUMP', 'BINARY']) assert.deepEqual(await index.search(query, session.id), []);
  assert.equal(store.getActiveSession().messages[0].content, original);
  assert.doesNotMatch(sanitizeContext('-----BEGIN RSA PRIVATE KEY-----\nUNIQUE_KEY\n-----END RSA PRIVATE KEY-----\n{"access_token":"JSON_TOKEN"}\nhttps://user:credential@example.com'), /UNIQUE_KEY|JSON_TOKEN|user:credential/);
});

test('request construction injects traceable old evidence, reserves budgets, and /context shows actual sources', async () => {
  const { store, first } = await seededStore();
  const input = { session: store.getActiveSession(), prompt: 'What was the internal test codename I gave earlier?', policyPrompt: 'Workspace access only.', accessScope: 'workspace', contextWindow: 8192, memory: new ChatMemoryIndex(store), options: defaults, sources: [{ category: 'references', label: 'safe reference', content: 'API_KEY=DO_NOT_SEND\nUseful reference' }, { category: 'workspace_retrieval', label: 'example.ts:1', path: 'example.ts', content: 'x'.repeat(30000) }] };
  const { messages, report } = await composeRequestContext(input);
  assert.match(JSON.stringify(messages), /ORBITAL-MANGO-91734/);
  assert.doesNotMatch(JSON.stringify(messages), /SILVER-PEAR|DO_NOT_SEND/);
  assert.equal(report.chatId, first.id);
  assert.equal(report.memories.length, 1);
  assert.equal(report.recentMessages.some((message) => message.messageId === report.memories[0].messageId), false);
  assert.equal(report.inputCharacters, messages.reduce((total, message) => total + message.content.length, 0));
  assert.ok(report.inputCharacters <= report.maximumInputCharacters);
  assert.ok(report.reservedOutputTokens > 0 && report.reservedSystemTokens > 0);
  assert.ok(report.exclusions.some((reason) => reason.includes('truncated')));
  const inspector = formatRequestContext(report);
  assert.match(inspector, /turn-supporting-fact/);
  assert.match(inspector, /ORBITAL-MANGO-91734/);
  assert.doesNotMatch(inspector, /DO_NOT_SEND/);
  const file = await composeRequestContext({ ...input, accessScope: 'file' });
  assert.equal(file.messages.length, 1);
  assert.deepEqual(file.report.memories, []);
  assert.deepEqual(file.report.sources, []);
  assert.doesNotMatch(JSON.stringify(file.messages), /ORBITAL|Useful reference/);
  assert.equal(file.report.memoryScope, 'disabled');
  const disabled = await composeRequestContext({ ...input, options: { ...defaults, enabled: false } });
  assert.deepEqual(disabled.report.memories, []);
  await assert.rejects(composeRequestContext({ ...input, prompt: 'x'.repeat(30000) }), /input budget/);
});

test('retrieval cancellation, invalid settings and bounded unique message results fail safely', async () => {
  const { store, first } = await seededStore();
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(new ChatMemoryIndex(store).search('codename', first.id, { signal: cancelled.signal }), (error) => error.name === 'AbortError');
  const bad = readChatMemoryOptions((key, fallback) => ({ scope: 'untrusted', enabled: 'yes', recentCharacters: -10, retrievedCharacters: NaN, resultCount: 1000 })[key] ?? fallback);
  assert.equal(bad.scope, 'current');
  assert.equal(bad.enabled, false);
  assert.equal(bad.recentCharacters, 0);
  assert.equal(bad.memoryCharacters, 3000);
  assert.equal(bad.resultCount, 20);
  await store.appendMessages(first.id, [{ role: 'user', content: ('matching-token '.repeat(300)) }]);
  const matches = await new ChatMemoryIndex(store).search('matching-token', first.id, { maximumCharacters: 80, limit: 20 });
  assert.equal(matches.length, 1);
  assert.ok(matches[0].text.length <= 80);
});

test('deleted or cleared source chats invalidate copied and transitive assistant memories, but never erase original history', async () => {
  const { store, state, first, second } = await seededStore();
  const original = store.getSessions().find((session) => session.id === second.id).messages[0];
  await store.appendMessages(first.id, [{ role: 'assistant', content: 'Recovered SILVER-PEAR-4826.', memorySources: [{ chatId: second.id, messageId: original.id }] }]);
  const copy = store.getActiveSession().messages.at(-1);
  await store.appendMessages(first.id, [{ role: 'assistant', content: 'Copied again: SILVER-PEAR-4826.', memorySources: [{ chatId: first.id, messageId: copy.id }] }]);
  const index = new ChatMemoryIndex(store);
  assert.ok((await index.search('SILVER-PEAR-4826', first.id)).length);
  await store.clearSession(second.id);
  assert.deepEqual(await index.search('SILVER-PEAR-4826', first.id, { scope: 'all' }), []);
  assert.doesNotMatch(JSON.stringify(recentChatMessages(store.getActiveSession(), 6000, store.getSessions())), /SILVER-PEAR/);
  assert.match(JSON.stringify(store.getActiveSession().messages), /SILVER-PEAR/);
  await store.deleteSession(second.id);
  const restarted = new SessionManager(state);
  await restarted.initialize();
  assert.deepEqual(await new ChatMemoryIndex(restarted).search('SILVER-PEAR-4826', first.id, { scope: 'all' }), []);
});

test('invalid provenance and cyclic memory dependencies cannot become trusted retrieval evidence', async () => {
  const { store, first } = await seededStore();
  await assert.rejects(store.appendMessages(first.id, [{ role: 'assistant', content: 'invalid', memorySources: [{ chatId: '', messageId: 'bad' }] }]), /source provenance/);
  await store.appendMessages(first.id, [
    { id: 'cycle-a', role: 'assistant', content: 'CYCLIC_PRIVATE', memorySources: [{ chatId: first.id, messageId: 'cycle-b' }] },
    { id: 'cycle-b', role: 'assistant', content: 'CYCLIC_PRIVATE', memorySources: [{ chatId: first.id, messageId: 'cycle-a' }] }
  ]);
  assert.deepEqual(await new ChatMemoryIndex(store).search('CYCLIC_PRIVATE', first.id), []);
});

test('chunk boundaries preserve unique words and tiny excerpts include the actual matching evidence', async () => {
  const store = new SessionManager(storage());
  await store.initialize();
  const session = store.getActiveSession();
  const content = `${'ordinary '.repeat(109)}EDGE-CODENAME-918273 remainder`;
  await store.appendMessages(session.id, [{ role: 'user', content }, { role: 'assistant', content }]);
  const matches = await new ChatMemoryIndex(store).search('EDGE-CODENAME-918273', session.id, { maximumCharacters: 80 });
  assert.equal(matches.length, 1);
  assert.match(matches[0].text, /EDGE-CODENAME-918273/);
  assert.equal(content.slice(matches[0].startCharacter, matches[0].endCharacter), matches[0].text);
});

test('a larger local conversation yields during retrieval and respects result and context bounds', async (context) => {
  const store = new SessionManager(storage());
  await store.initialize();
  const session = store.getActiveSession();
  await store.appendMessages(session.id, Array.from({ length: 1200 }, (_, index) => ({ role: 'user', content: `Discussion ${index}: ${'ordinary later text '.repeat(60)}${index === 113 ? 'SCALE-ORCHID-39182' : ''}` })));
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const started = performance.now();
  const matches = await new ChatMemoryIndex(store).search('SCALE-ORCHID-39182', session.id, { maximumCharacters: 500, limit: 3 });
  context.diagnostic(`1200-message lexical retrieval: ${(performance.now() - started).toFixed(1)} ms`);
  assert.equal(yielded, true);
  assert.equal(matches.length, 1);
  assert.match(matches[0].text, /SCALE-ORCHID-39182/);
  assert.ok(matches[0].text.length <= 500);
});
