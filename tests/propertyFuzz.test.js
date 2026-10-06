const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TaskGraph } = require('../dist/agent/orchestration/taskGraph');
const { RunStateMachine } = require('../dist/runtime/runStateMachine');
const { ShellParser } = require('../dist/policy/shellParser');

// Seeded PRNG (xorshift32) for reproducible property-based testing
class SeededRng {
  constructor(seed = 0xdeadbeef) {
    this.state = seed;
  }
  next() {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  choice(arr) {
    return arr[this.nextInt(0, arr.length - 1)];
  }
}

test('Property-based and generative fuzz harness runs 30,000 executions across graphs, state machines, and parsers', () => {
  const rng = new SeededRng(0xdeadbeef);

  // 1. TaskGraph property test (10,000 graph operations)
  let graphOps = 0;
  for (let iter = 0; iter < 1000; iter++) {
    const graph = new TaskGraph();
    const nodeCount = rng.nextInt(3, 8);
    const nodeIds = [];

    for (let i = 0; i < nodeCount; i++) {
      const id = `node-${iter}-${i}`;
      nodeIds.push(id);
      graph.addNode({
        id,
        title: `Node ${i}`,
        description: `Desc ${i}`,
        role: 'coder',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      graphOps++;
    }

    // Add random valid acyclic dependencies
    for (let i = 1; i < nodeCount; i++) {
      const parentId = nodeIds[rng.nextInt(0, i - 1)];
      graph.addDependency(nodeIds[i], parentId);
      graphOps++;
    }

    // Attempt random cycle and verify it is rejected
    const cycleChild = nodeIds[0];
    const cycleParent = nodeIds[nodeCount - 1];
    assert.throws(
      () => graph.addDependency(cycleChild, cycleParent),
      /Cyclic dependency detected/
    );
    graphOps++;
  }
  assert.ok(graphOps >= 10000, `Graph ops was ${graphOps}`);

  // 2. RunStateMachine state transition property test (10,000 transitions)
  let smTransitions = 0;
  const states = [
    'idle',
    'initializing',
    'planning',
    'executing',
    'paused',
    'recovering',
    'completed',
    'failed',
    'cancelled'
  ];

  for (let iter = 0; iter < 1000; iter++) {
    const sm = new RunStateMachine(`fuzz-run-${iter}`);
    for (let step = 0; step < 10; step++) {
      const target = rng.choice(states);
      smTransitions++;
      if (sm.canTransitionTo(target)) {
        sm.transitionTo(target);
      } else {
        assert.throws(
          () => sm.transitionTo(target),
          /Illegal state transition/
        );
      }
    }
  }
  assert.equal(smTransitions, 10000);

  // 3. ShellParser generative fuzz test (10,000 parsed commands)
  let shellParses = 0;
  const programs = ['git', 'npm', 'node', 'cargo', 'rm', 'del', 'curl', 'echo', 'cat', 'ls'];
  const args = ['status', 'test', 'build', '-rf', '/', 'c:\\', '--verbose', 'file.txt', 'https://example.com'];
  const operators = ['&&', '||', ';', '|', '&'];

  for (let i = 0; i < 10000; i++) {
    shellParses++;
    const segCount = rng.nextInt(1, 4);
    const parts = [];

    for (let s = 0; s < segCount; s++) {
      const p = rng.choice(programs);
      const a = rng.choice(args);
      parts.push(`${p} ${a}`);
      if (s < segCount - 1) {
        parts.push(rng.choice(operators));
      }
    }

    const cmd = parts.join(' ');
    const parsed = ShellParser.parse(cmd);
    assert.ok(parsed.segments.length > 0);

    // If 'rm -rf /' was generated, must be flagged destructive
    if (cmd.includes('rm -rf /')) {
      assert.equal(parsed.hasDestructiveSegment, true);
    }
  }
  assert.equal(shellParses, 10000);

  console.log(`[PropertyFuzz] Completed ${graphOps + smTransitions + shellParses} seeded fuzz executions.`);
});
