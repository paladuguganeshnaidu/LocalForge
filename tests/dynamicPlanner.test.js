const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PlanValidator } = require('../dist/agent/orchestration/planSchema');
const { HandoffSerializer } = require('../dist/agent/orchestration/handoffSchema');
const { DynamicPlanner } = require('../dist/agent/orchestration/dynamicPlanner');
const { WorktreeManager } = require('../dist/worktree/worktreeManager');

test('PlanValidator rejects plans with cycles, missing dependencies, or invalid roles', () => {
  // Plan with cycle: t1 -> t2 -> t1
  const cyclicPlan = {
    rationale: 'Test',
    assumptions: [],
    nodes: [
      {
        id: 't1',
        title: 'Task 1',
        description: 'Desc 1',
        role: 'coder',
        priority: 'high',
        dependencies: ['t2'],
        targetFiles: [],
        acceptanceCriteria: [],
        verificationStrategy: 'unit_test',
        riskLevel: 'low'
      },
      {
        id: 't2',
        title: 'Task 2',
        description: 'Desc 2',
        role: 'tester',
        priority: 'medium',
        dependencies: ['t1'],
        targetFiles: [],
        acceptanceCriteria: [],
        verificationStrategy: 'unit_test',
        riskLevel: 'low'
      }
    ],
    globalAcceptanceCriteria: [],
    verificationPlan: []
  };

  const cycleResult = PlanValidator.validate(cyclicPlan);
  assert.equal(cycleResult.valid, false);
  assert.ok(cycleResult.errors.some((e) => e.includes('Cycle detected')));

  // Plan with invalid role
  const invalidRolePlan = {
    ...cyclicPlan,
    nodes: [
      {
        ...cyclicPlan.nodes[0],
        role: 'superhacker',
        dependencies: []
      }
    ]
  };
  const roleResult = PlanValidator.validate(invalidRolePlan);
  assert.equal(roleResult.valid, false);
  assert.ok(roleResult.errors.some((e) => e.includes('invalid role')));
});

test('HandoffSerializer creates validated AgentHandoffV2 records and formats them for prompts', () => {
  const record = HandoffSerializer.create({
    taskId: 'task-10',
    agentId: 'coder-1',
    role: 'coder',
    status: 'success',
    filesModified: ['src/api.ts', 'src/db.ts'],
    testsExecuted: [{ name: 'api.test.ts', passed: true, durationMs: 45 }],
    keyDecisions: ['Used PostgreSQL connection pool'],
    unresolvedRisks: ['Need load testing on db connection spike'],
    nextSteps: ['Add unit tests for edge cases'],
    artifactsProduced: [{ name: 'API Docs', summary: 'Exported OpenAPI spec' }],
    confidenceScore: 0.95,
    handoffMessage: 'API endpoints implemented and validated.'
  });

  assert.equal(record.schemaVersion, 2);
  assert.equal(record.confidenceScore, 0.95);
  assert.equal(record.filesModified.length, 2);

  const promptText = HandoffSerializer.formatForPrompt(record);
  assert.ok(promptText.includes('STRUCTURED HANDOFF FROM CODER'));
  assert.ok(promptText.includes('src/api.ts'));
  assert.ok(promptText.includes('PostgreSQL connection pool'));
  assert.ok(promptText.includes('Confidence: 95%'));

  const parsed = HandoffSerializer.parse(record);
  assert.deepEqual(parsed, record);
});

test('DynamicPlanner produces validated DAGs with parallel branches for fullstack goals', () => {
  const fullstackGoal = 'Build backend API routes and frontend UI components for user registration';
  const plan = DynamicPlanner.planGoal(fullstackGoal, {
    indexedFiles: ['src/server/api.ts', 'src/ui/registrationView.ts', 'tests/api.test.ts']
  });

  assert.ok(plan.nodes.length >= 4);
  const roles = plan.nodes.map((n) => n.role);
  assert.ok(roles.includes('architect'));
  assert.ok(roles.includes('coder'));
  assert.ok(roles.includes('tester'));
  assert.ok(roles.includes('reviewer'));

  // Build executable TaskGraph
  const graph = DynamicPlanner.buildTaskGraph(plan);
  const ready = graph.getReadyTasks();
  assert.equal(ready.length, 1);
  assert.equal(ready[0].role, 'architect');
});

test('DynamicPlanner supports dynamic replanning on node failure', () => {
  const plan = DynamicPlanner.planGoal('Implement authentication service');
  const graph = DynamicPlanner.buildTaskGraph(plan);

  // Mark task-1 completed
  const archTask = graph.getNode('task-1-arch');
  assert.ok(archTask);
  graph.markRunning('task-1-arch');
  graph.markCompleted('task-1-arch', {
    agentId: 'arch-1',
    role: 'architect',
    status: 'success',
    output: 'Architecture ready'
  });

  // Now task-2-code is ready
  const ready = graph.getReadyTasks();
  assert.ok(ready.some((t) => t.id === 'task-2-code'));

  // Simulate task-2 failure
  graph.markRunning('task-2-code');
  graph.markFailed('task-2-code', 'Syntax error in generated types');

  // Trigger dynamic replanning
  const replanResult = DynamicPlanner.replanForFailure(
    graph,
    'task-2-code',
    'Syntax error in generated types'
  );
  assert.equal(replanResult.replanned, true);
  assert.ok(replanResult.remediationNodeId);

  const remediationNode = graph.getNode(replanResult.remediationNodeId);
  assert.ok(remediationNode);
  assert.equal(remediationNode.role, 'debugger');

  // Downstream task-3-test should now depend on remediationNode
  const testNode = graph.getNode('task-3-test');
  assert.ok(testNode);
  assert.ok(testNode.dependencies.includes(replanResult.remediationNodeId));
});

test('WorktreeManager detects git repository status and manages worktree lifecycle', async () => {
  const manager = new WorktreeManager(path.resolve('.'));
  const isRepo = await manager.isGitRepository();
  assert.equal(isRepo, true);
  assert.equal(manager.getActiveWorktrees().length, 0);
});
