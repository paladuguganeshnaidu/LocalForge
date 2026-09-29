const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { isTrusted: true, workspaceFolders: [] },
      Uri: {
        file: (p) => ({ fsPath: p, toString: () => `file://${p}` }),
        joinPath: (base, ...segs) => ({ fsPath: `${base.fsPath}/${segs.join('/')}`, toString: () => `${base.toString()}/${segs.join('/')}` })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { TaskGraph } = require('../dist/agent/orchestration/taskGraph.js');
const { AgentRegistry } = require('../dist/agent/orchestration/agentRegistry.js');
const { AgentPool } = require('../dist/agent/orchestration/agentPool.js');
const { CheckpointManager } = require('../dist/agent/orchestration/checkpointManager.js');

test('AgentRegistry contains all 12 specialized agent roles with valid prompts and tools', () => {
  const roles = AgentRegistry.getAllRoles();
  assert.equal(roles.length, 12);

  const expectedRoles = [
    'orchestrator',
    'planner',
    'repository_analyst',
    'researcher',
    'coder',
    'test_engineer',
    'debugger',
    'reviewer',
    'security_reviewer',
    'documentation_agent',
    'git_agent',
    'performance_agent'
  ];

  for (const r of expectedRoles) {
    assert.equal(AgentRegistry.isValidRole(r), true, `Role ${r} should be valid`);
    const def = AgentRegistry.getRole(r);
    assert.ok(def.displayName.length > 0);
    assert.ok(def.systemPrompt.length > 0);
    assert.ok(def.allowedToolCategories.length > 0);
  }
});

test('TaskGraph manages DAG dependencies, execution ordering, and detects cycles', () => {
  const graph = new TaskGraph();

  graph.addNode({
    id: 'task-a',
    title: 'Understand repo',
    description: 'Inspect structure',
    role: 'repository_analyst',
    dependencies: [],
    targetFiles: ['src/index.ts'],
    priority: 'high',
    maxRetries: 1
  });

  graph.addNode({
    id: 'task-b',
    title: 'Plan change',
    description: 'Design architecture',
    role: 'planner',
    dependencies: ['task-a'],
    targetFiles: ['src/index.ts'],
    priority: 'high',
    maxRetries: 1
  });

  graph.addNode({
    id: 'task-c',
    title: 'Implement backend',
    description: 'Write API',
    role: 'coder',
    dependencies: ['task-b'],
    targetFiles: ['src/api.ts'],
    priority: 'urgent',
    maxRetries: 2
  });

  // Cycle detection
  assert.throws(() => {
    graph.addDependency('task-a', 'task-c');
  }, /Cyclic dependency/);

  // Ready tasks: initially only task-a
  const ready = graph.getReadyTasks();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, 'task-a');

  // Complete task-a
  graph.markRunning('task-a');
  graph.markCompleted('task-a', {
    runId: 'run-1',
    agentId: 'ag-1',
    role: 'repository_analyst',
    taskId: 'task-a',
    status: 'completed',
    output: 'Analysis done',
    filesModified: [],
    durationMs: 100
  });

  // Now task-b should be ready
  const readyAfterA = graph.getReadyTasks();
  assert.equal(readyAfterA.length, 1);
  assert.equal(readyAfterA[0].id, 'task-b');
});

test('TaskGraph prevents parallel file write conflicts', () => {
  const graph = new TaskGraph();

  graph.addNode({
    id: 'task-1',
    title: 'Edit Auth',
    description: 'Modify auth.ts',
    role: 'coder',
    dependencies: [],
    targetFiles: ['src/auth.ts'],
    priority: 'high',
    maxRetries: 1
  });

  graph.addNode({
    id: 'task-2',
    title: 'Refactor Auth',
    description: 'Also modifies auth.ts',
    role: 'coder',
    dependencies: [],
    targetFiles: ['src/auth.ts'],
    priority: 'medium',
    maxRetries: 1
  });

  // Both have no dependencies, but task-1 is higher priority
  const ready = graph.getReadyTasks();
  assert.equal(ready.length, 2);

  // Once task-1 is running, task-2 cannot be dispatched due to file conflict
  graph.markRunning('task-1');
  const readyWhileRunning = graph.getReadyTasks();
  assert.equal(readyWhileRunning.length, 0, 'task-2 should be blocked due to file conflict with running task-1');

  // After task-1 completes, task-2 becomes ready
  graph.markCompleted('task-1', {
    runId: 'run-1',
    agentId: 'ag-1',
    role: 'coder',
    taskId: 'task-1',
    status: 'completed',
    output: 'Done',
    filesModified: ['src/auth.ts'],
    durationMs: 50
  });

  const readyAfterDone = graph.getReadyTasks();
  assert.equal(readyAfterDone.length, 1);
  assert.equal(readyAfterDone[0].id, 'task-2');
});

test('AgentPool enforces concurrency limits and cooperative cancellation', () => {
  const pool = new AgentPool(2);

  const parentController = new AbortController();
  const c1 = pool.acquire('agent-1', 'coder', 'task-1', parentController.signal);
  const c2 = pool.acquire('agent-2', 'reviewer', 'task-2', parentController.signal);

  assert.equal(pool.getActiveCount(), 2);
  assert.equal(pool.canAcquire(), false);

  assert.throws(() => {
    pool.acquire('agent-3', 'test_engineer', 'task-3');
  }, /capacity exceeded/);

  // Cancelling parent aborts all children
  parentController.abort();
  assert.equal(c1.signal.aborted, true);
  assert.equal(c2.signal.aborted, true);

  pool.release('agent-1');
  pool.release('agent-2');
  assert.equal(pool.getActiveCount(), 0);
  assert.equal(pool.canAcquire(), true);
});

test('CheckpointManager serializes, saves, and restores TaskGraph checkpoints', async () => {
  let storedData = undefined;
  const mockStorage = {
    get: (key) => storedData,
    update: async (key, val) => { storedData = val; }
  };

  const mgr = new CheckpointManager(mockStorage);
  assert.equal(mgr.hasIncompleteCheckpoint(), false);

  const graph = new TaskGraph();
  graph.addNode({
    id: 't-1',
    title: 'Step 1',
    description: 'Do step 1',
    role: 'coder',
    dependencies: [],
    targetFiles: ['a.ts'],
    priority: 'high',
    maxRetries: 2
  });

  await mgr.saveCheckpoint({
    runId: 'run-checkpoint-1',
    task: 'Build feature',
    mode: 'agent',
    graph: graph.serialize(),
    filesModified: ['a.ts'],
    timestamp: Date.now(),
    status: 'running'
  });

  assert.equal(mgr.hasIncompleteCheckpoint(), true);
  const restoredGraph = mgr.restoreTaskGraph();
  assert.ok(restoredGraph);
  assert.equal(restoredGraph.getAllNodes().length, 1);
  assert.equal(restoredGraph.getNode('t-1')?.title, 'Step 1');

  await mgr.clearCheckpoint();
  assert.equal(mgr.hasIncompleteCheckpoint(), false);
});
