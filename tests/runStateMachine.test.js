const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunStateMachine } = require('../dist/runtime/runStateMachine');
const { RunBudgetManager } = require('../dist/runtime/runBudget');
const { CancellationTree } = require('../dist/runtime/cancellationTree');
const { ResourceLeaseManager } = require('../dist/runtime/resourceLeaseManager');
const { RunManager } = require('../dist/runtime/runManager');

test('RunStateMachine enforces valid transitions and rejects invalid ones', () => {
  const sm = new RunStateMachine('run-test-1');
  assert.equal(sm.getState(), 'idle');
  assert.equal(sm.isTerminal(), false);

  // Illegal: idle -> executing directly
  assert.throws(() => sm.transitionTo('executing'), /Illegal state transition/);

  // Valid: idle -> initializing -> planning -> executing
  sm.transitionTo('initializing');
  assert.equal(sm.getState(), 'initializing');

  sm.transitionTo('planning');
  assert.equal(sm.getState(), 'planning');

  sm.transitionTo('executing');
  assert.equal(sm.getState(), 'executing');

  // Pause and resume
  sm.transitionTo('paused');
  assert.equal(sm.getState(), 'paused');

  sm.transitionTo('executing');
  assert.equal(sm.getState(), 'executing');

  // Complete
  sm.transitionTo('completed');
  assert.equal(sm.getState(), 'completed');
  assert.equal(sm.isTerminal(), true);

  // Cannot transition out of terminal without reset
  assert.throws(() => sm.transitionTo('executing'), /Illegal state transition/);

  // Reset to idle
  sm.reset();
  assert.equal(sm.getState(), 'idle');
});

test('RunBudgetManager tracks and halts on budget violations', () => {
  const budget = new RunBudgetManager({
    maxToolCalls: 3,
    maxTokens: 100,
    maxDurationMs: 10_000,
    maxChildAgents: 2,
    maxFilesMutated: 2
  });

  budget.recordToolCall();
  budget.recordToolCall();
  assert.equal(budget.getUsage().toolCalls, 2);

  budget.recordTokens(50);
  assert.equal(budget.getUsage().tokens, 50);

  // Third tool call should succeed (reaches limit)
  budget.recordToolCall();
  assert.equal(budget.getUsage().toolCalls, 3);

  // Fourth tool call exceeds limit
  assert.throws(() => budget.recordToolCall(), /Budget violation.*maximum tool calls limit/);

  // File mutations
  const fileBudget = new RunBudgetManager({ maxFilesMutated: 1 });
  fileBudget.recordFileMutation('src/a.ts');
  assert.throws(() => fileBudget.recordFileMutation('src/b.ts'), /Budget violation.*maximum file mutation limit/);
});

test('CancellationTree cascades cancellation from parent to child with timeout support', async () => {
  const tree = new CancellationTree('root-tree');
  const runNode = tree.createChild({ id: 'run-node', name: 'Run Context' });
  const taskNode = runNode.createChild({ id: 'task-node', name: 'Task Context' });
  const toolNode = taskNode.createChild({ id: 'tool-node', name: 'Tool Context' });

  assert.equal(runNode.isCancelled, false);
  assert.equal(taskNode.isCancelled, false);
  assert.equal(toolNode.isCancelled, false);

  // Cancelling runNode cascades to taskNode and toolNode
  runNode.cancel('user-stop');
  assert.equal(runNode.isCancelled, true);
  assert.equal(taskNode.isCancelled, true);
  assert.equal(toolNode.isCancelled, true);

  // Timeout node
  const timedNode = tree.createChild({ id: 'timed-node', timeoutMs: 50 });
  assert.equal(timedNode.isCancelled, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(timedNode.isCancelled, true);

  tree.dispose();
});

test('ResourceLeaseManager manages leases with conflict detection and LIFO cleanup', async () => {
  const manager = new ResourceLeaseManager();
  const released = [];

  const lease1 = await manager.acquire('run-1', 'file', 'src/app.ts', () => {
    released.push('lease1');
  });

  // Second acquisition of same resource fails
  await assert.rejects(
    () => manager.acquire('run-1', 'file', 'src/app.ts', () => {}),
    /Resource conflict.*already leased/
  );

  const lease2 = await manager.acquire('run-1', 'process', 'proc-99', () => {
    released.push('lease2');
  });

  assert.equal(manager.isLeased('file', 'src/app.ts'), true);
  assert.equal(manager.isLeased('process', 'proc-99'), true);

  // Release all for run-1 in LIFO order (lease2 then lease1)
  await manager.releaseAllForRun('run-1');
  assert.deepEqual(released, ['lease2', 'lease1']);
  assert.equal(manager.isLeased('file', 'src/app.ts'), false);
  assert.equal(manager.isLeased('process', 'proc-99'), false);
});

test('RunManager orchestrates end-to-end run lifecycle and cancellation', async () => {
  const manager = new RunManager();
  const run = manager.startRun('Build full stack app', {
    budget: { maxToolCalls: 10 }
  });

  assert.equal(run.manifest.status, 'initializing');
  assert.equal(manager.getActiveRunId(), run.manifest.runId);

  // Transition to planning then executing
  run.stateMachine.transitionTo('planning');
  run.stateMachine.transitionTo('executing');
  assert.equal(run.manifest.status, 'executing');

  // Acquire lease
  let leaseCleaned = false;
  await manager.leaseManager.acquire(run.manifest.runId, 'worktree', 'branch-1', () => {
    leaseCleaned = true;
  });

  // Cancel run
  await manager.cancelRun(run.manifest.runId, 'test-cancellation');
  assert.equal(run.stateMachine.getState(), 'cancelled');
  assert.equal(run.cancellationNode.isCancelled, true);
  assert.equal(leaseCleaned, true);
  assert.equal(manager.getActiveRun(), undefined);

  await manager.dispose();
});
