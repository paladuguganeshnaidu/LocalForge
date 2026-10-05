const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SessionManager } = require('../dist/core/sessionManager');

class Storage {
  constructor(initial = {}) { this.values = structuredClone(initial); this.fail = false; }
  get(key, fallback) { return structuredClone(this.values[key] ?? fallback); }
  async update(key, value) {
    await new Promise((resolve) => setImmediate(resolve));
    if (this.fail) throw new Error('Simulated storage failure');
    this.values[key] = structuredClone(value);
  }
}

test('chat identities survive model changes, rename, rapid queued operations and restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-conversations-'));
  const storage = new Storage();
  try {
    const store = new SessionManager(storage, directory);
    await store.initialize();
    const first = store.getActiveSession();
    await store.appendMessages(first.id, [{ role: 'user', content: 'LOCALFORGE_CHAT_A_FACT_7391' }]);
    const second = await store.createNewSession('B');
    await store.appendMessages(second.id, [{ role: 'user', content: 'LOCALFORGE_CHAT_B_FACT_4826' }]);
    await Promise.all([store.setActiveSession(first.id), store.updateSession(first.id, { model: 'provider-a:shared' }), store.renameSession(second.id, 'Renamed B'), store.updateSession(first.id, { model: 'provider-b:shared' })]);
    const restored = new SessionManager(storage, directory);
    await restored.initialize();
    assert.equal(restored.getActiveSession().id, first.id);
    assert.equal(restored.getActiveSession().model, 'provider-b:shared');
    assert.equal(restored.getActiveSession().messages[0].content, 'LOCALFORGE_CHAT_A_FACT_7391');
    assert.equal(restored.getSessions().find((session) => session.id === second.id).title, 'Renamed B');
    assert.equal(restored.getSessions().find((session) => session.id === second.id).messages[0].content, 'LOCALFORGE_CHAT_B_FACT_4826');
    assert.ok(restored.getActiveSession().messages[0].id);
    await restored.updateSession(first.id, { effort: 'ultra' });
    const effortRestored = new SessionManager(storage, directory);
    await effortRestored.initialize();
    assert.equal(effortRestored.getActiveSession().effort, 'ultra');
    await assert.rejects(effortRestored.updateSession(first.id, { effort: 'infinite' }), /Invalid conversation effort/);
    await restored.deleteSession(first.id);
    const afterDelete = new SessionManager(storage, directory);
    await afterDelete.initialize();
    assert.equal(afterDelete.getSessions().some((session) => session.id === first.id), false);
    assert.equal(afterDelete.getActiveSession().id, second.id);
    await afterDelete.clearSession(second.id);
    const afterClear = new SessionManager(storage, directory);
    await afterClear.initialize();
    assert.deepEqual(afterClear.getActiveSession().messages, []);
    await afterClear.deleteSession(second.id);
    assert.equal(afterClear.getSessions().length, 1);
    assert.equal(afterClear.getActiveSession().messages.length, 0);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('legacy model keyed histories migrate once without deleting originals or duplicating a matching session', async () => {
  const storage = new Storage({
    'localforge.workspaceSessions': [{ id: 'old-a', title: 'A', mode: 'ask', model: 'model-a', messages: [{ role: 'user', content: 'old fact' }], filesModified: ['kept.txt'] }],
    'localforge.activeSessionId': 'old-a',
    'localforge.conversations': { 'model-a': [{ role: 'user', content: 'old fact' }], 'model-b': [{ role: 'assistant', content: 'separate UI history' }] }
  });
  const store = new SessionManager(storage);
  await store.initialize();
  assert.equal(store.getSessions().length, 2);
  assert.equal(store.getActiveSession().id, 'old-a');
  assert.deepEqual(store.getActiveSession().filesModified, ['kept.txt']);
  const imported = store.getSessions().find((session) => session.model === 'model-b');
  await store.deleteSession(imported.id);
  const restarted = new SessionManager(storage);
  await restarted.initialize();
  assert.equal(restarted.getSessions().length, 1);
  assert.ok(storage.get('localforge.conversations')['model-b']);
});

test('failed writes preserve committed state and stale saves cannot resurrect deleted or cleared chats', async () => {
  const storage = new Storage();
  const store = new SessionManager(storage);
  await store.initialize();
  const original = store.getActiveSession();
  storage.fail = true;
  await assert.rejects(store.renameSession(original.id, 'Must not persist'), /storage failure/);
  assert.equal(store.getActiveSession().title, original.title);
  storage.fail = false;
  await store.appendMessages(original.id, [{ role: 'user', content: 'old content' }]);
  const stale = store.getActiveSession();
  await store.clearSession(original.id);
  await assert.rejects(store.appendMessages(original.id, [{ role: 'assistant', content: 'Late answer' }], {}, { epoch: stale.historyEpoch }), /cleared/);
  await assert.rejects(store.saveSession(stale), /stale/);
  assert.deepEqual(store.getActiveSession().messages, []);
  await store.deleteSession(original.id);
  await assert.rejects(store.saveSession(stale), /deleted/);
  await store.deleteSession('nonexistent');
  assert.equal(store.getSessions().length, 1);
});

test('a corrupt private store fails closed and never silently reimports deleted legacy chats', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-conversations-'));
  try {
    const filename = path.join(directory, 'conversations.v2.json');
    await fs.writeFile(filename, '{corrupt', 'utf8');
    const store = new SessionManager(new Storage(), directory);
    await assert.rejects(store.initialize(), /preserved for recovery/);
    assert.equal(await fs.readFile(filename, 'utf8'), '{corrupt');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
