const assert = require('node:assert/strict');
const { test } = require('node:test');

// In-memory mock for vscode.Memento
class MockMemento {
  constructor() {
    this.storage = new Map();
  }
  get(key, defaultValue) {
    return this.storage.has(key) ? this.storage.get(key) : defaultValue;
  }
  async update(key, value) {
    if (value === undefined) {
      this.storage.delete(key);
    } else {
      this.storage.set(key, value);
    }
  }
}

const { SessionManager } = require('../dist/core/sessionManager.js');
const { TaskManager } = require('../dist/core/taskManager.js');

test('SessionManager manages workspace sessions in memento storage', async () => {
  const memento = new MockMemento();
  const sm = new SessionManager(memento);

  const initial = sm.getActiveSession();
  assert.ok(initial.id);
  assert.equal(initial.title, 'New Session');

  initial.messages.push({ role: 'user', content: 'Hello' });
  await sm.saveSession(initial);

  const sessions = sm.getSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].messages.length, 1);

  const newSess = await sm.createNewSession('Refactor session', 'plan');
  assert.equal(sm.getSessions().length, 2);
  assert.equal(sm.getActiveSession().id, newSess.id);

  await sm.deleteSession(initial.id);
  assert.equal(sm.getSessions().length, 1);
});

test('TaskManager records tasks and retrieves last task', async () => {
  const memento = new MockMemento();
  const tm = new TaskManager(memento);

  assert.equal(tm.getLastTask(), undefined);

  const task = await tm.recordTaskStart('Add JWT auth', 'agent', 'qwen2.5-coder');
  assert.equal(task.task, 'Add JWT auth');
  assert.equal(task.status, 'planning');

  await tm.recordTaskCompletion(task.id, 'completed', ['src/auth.ts'], 'Implemented auth', {
    command: 'npm test',
    passed: true,
    summary: 'All tests passed'
  });

  const last = tm.getLastTask();
  assert.equal(last.id, task.id);
  assert.equal(last.status, 'completed');
  assert.deepEqual(last.filesModified, ['src/auth.ts']);
  assert.equal(last.validationPassed, true);
});
