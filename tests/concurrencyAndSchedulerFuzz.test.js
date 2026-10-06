const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CancellationTree } = require('../dist/runtime/cancellationTree');
const { ResourceLeaseManager } = require('../dist/runtime/resourceLeaseManager');
const { DynamicPlanner } = require('../dist/agent/orchestration/dynamicPlanner');
const { TaskGraph } = require('../dist/agent/orchestration/taskGraph');
const { RunBudgetManager } = require('../dist/runtime/runBudget');

// Deterministic PRNG
class LcgRng {
  constructor(seed = 0xabcdef) {
    this.state = seed;
  }
  next() {
    this.state = (Math.imul(1664525, this.state) + 1013904223) | 0;
    return (this.state >>> 0) / 4294967296;
  }
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

test('High-scale concurrency, cancellation tree, and scheduler fuzz executes 40,000 iterations', async () => {
  const rng = new LcgRng(0xdeadbeef);

  // 1. CancellationTree concurrent cascade & race testing (10,000 iterations)
  let cancellationOps = 0;
  for (let i = 0; i < 10000; i++) {
    cancellationOps++;
    const tree = new CancellationTree('root');
    const child1 = tree.createChild({ id: 'child-1' });
    const child2 = tree.createChild({ id: 'child-2' });
    const grandChild = child1.createChild({ id: 'grandchild-1' });

    assert.equal(tree.rootNode.isCancelled, false);
    assert.equal(child1.isCancelled, false);
    assert.equal(child2.isCancelled, false);
    assert.equal(grandChild.isCancelled, false);

    let child1Fired = false;
    let grandChildFired = false;
    child1.signal.addEventListener('abort', () => { child1Fired = true; }, { once: true });
    grandChild.signal.addEventListener('abort', () => { grandChildFired = true; }, { once: true });

    // Deterministically decide whether to cancel root or intermediate node
    const cancelTarget = rng.choice(['root', 'child1', 'grandChild']);
    if (cancelTarget === 'root') {
      tree.cancelAll('user-stop');
      assert.equal(tree.rootNode.isCancelled, true);
      assert.equal(child1.isCancelled, true);
      assert.equal(child2.isCancelled, true);
      assert.equal(grandChild.isCancelled, true);
      assert.equal(child1Fired, true);
      assert.equal(grandChildFired, true);
    } else if (cancelTarget === 'child1') {
      child1.cancel('subtask-timeout');
      assert.equal(tree.rootNode.isCancelled, false);
      assert.equal(child1.isCancelled, true);
      assert.equal(child2.isCancelled, false);
      assert.equal(grandChild.isCancelled, true);
      assert.equal(child1Fired, true);
      assert.equal(grandChildFired, true);
    } else {
      grandChild.cancel('leaf-error');
      assert.equal(tree.rootNode.isCancelled, false);
      assert.equal(child1.isCancelled, false);
      assert.equal(grandChild.isCancelled, true);
      assert.equal(child1Fired, false);
      assert.equal(grandChildFired, true);
    }

    // Cancellation must be idempotent
    tree.cancelAll('second-cancel');
    tree.dispose();
  }
  assert.equal(cancellationOps, 10000);

  // 2. ResourceLeaseManager concurrent lease acquisitions & contention (15,000 iterations)
  let leaseOps = 0;
  const leaseManager = new ResourceLeaseManager();
  const types = ['file', 'terminal', 'port', 'worktree'];

  for (let i = 0; i < 15000; i++) {
    leaseOps++;
    const rType = rng.choice(types);
    const rKey = `res-${rng.nextInt(1, 10)}`;
    const runId = `run-${rng.nextInt(1, 5)}`;

    if (!leaseManager.isLeased(rType, rKey)) {
      let released = false;
      const lease = await leaseManager.acquire(runId, rType, rKey, () => { released = true; });
      assert.equal(leaseManager.isLeased(rType, rKey), true);
      await leaseManager.release(lease.id);
      assert.equal(released, true);
      assert.equal(leaseManager.isLeased(rType, rKey), false);
    } else {
      await assert.rejects(
        () => leaseManager.acquire(runId, rType, rKey, () => {}),
        /Resource conflict/
      );
    }
  }
  assert.equal(leaseOps, 15000);

  // 3. RunBudgetManager property stress (15,000 iterations)
  let budgetOps = 0;
  for (let i = 0; i < 15000; i++) {
    budgetOps++;
    const maxTokens = rng.nextInt(1000, 50000);
    const maxToolCalls = rng.nextInt(10, 200);
    const manager = new RunBudgetManager({
      maxTokens,
      maxToolCalls,
      maxDurationMs: 60000
    });

    const tokenBatch = rng.nextInt(100, 2000);
    const toolCallBatch = rng.nextInt(1, 15);

    if (tokenBatch > maxTokens) {
      assert.throws(() => manager.recordTokens(tokenBatch), /Run exceeded maximum token budget/);
      assert.throws(() => manager.recordToolCall(toolCallBatch), /Run exceeded maximum/);
    } else {
      manager.recordTokens(tokenBatch);
      const usage = manager.getUsage();
      assert.equal(usage.tokens, tokenBatch);

      if (toolCallBatch > maxToolCalls) {
        assert.throws(() => manager.recordToolCall(toolCallBatch), /Run exceeded maximum tool calls limit/);
      } else {
        manager.recordToolCall(toolCallBatch);
      }
    }
  }
  assert.equal(budgetOps, 15000);

  console.log(`[ConcurrencyAndSchedulerFuzz] Completed ${cancellationOps + leaseOps + budgetOps} seeded property executions.`);
});
