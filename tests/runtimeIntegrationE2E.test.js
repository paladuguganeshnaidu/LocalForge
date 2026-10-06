const assert = require('node:assert/strict');
const { test } = require('node:test');

const { RunManager } = require('../dist/runtime/runManager');
const { MultiAgentOrchestrator } = require('../dist/agent/orchestration/orchestrator');
const { DynamicPlanner } = require('../dist/agent/orchestration/dynamicPlanner');
const { CheckpointManager } = require('../dist/agent/orchestration/checkpointManager');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { PolicyBroker } = require('../dist/policy/policyBroker');
const { WorktreeManager } = require('../dist/worktree/worktreeManager');
const { ComputerUseManager } = require('../dist/computerUse/computerUseManager');
const { MockDesktopAdapter } = require('../dist/computerUse/desktopAdapters');

const { getBuiltinToolDescriptor } = require('../dist/agent/toolPolicy');

test('RunManager orchestrates run state, budget, and deterministic cancellation', async () => {
  const runManager = new RunManager();
  const runContext = runManager.startRun('Refactor auth subsystem', { mode: 'autonomous' });

  assert.ok(runContext.manifest.runId);
  assert.equal(runManager.getActiveRunId(), runContext.manifest.runId);
  assert.equal(runContext.manifest.status, 'initializing');

  runContext.stateMachine.transitionTo('planning', 'planning_started');
  assert.equal(runContext.manifest.status, 'planning');

  runContext.stateMachine.transitionTo('executing', 'subagents_dispatched');
  assert.equal(runContext.manifest.status, 'executing');

  // Complete run
  await runManager.completeRun(runContext.manifest.runId);
  assert.equal(runContext.manifest.status, 'completed');
  assert.equal(runManager.getActiveRunId(), undefined);

  // Cancellation test
  const cancelRun = runManager.startRun('Long running task');
  let abortSignalReceived = false;
  cancelRun.cancellationNode.signal.addEventListener('abort', () => {
    abortSignalReceived = true;
  });

  await runManager.cancelRun(cancelRun.manifest.runId, 'Test abort');
  assert.equal(abortSignalReceived, true);
  assert.equal(cancelRun.manifest.status, 'cancelled');

  await runManager.dispose();
});

test('MultiAgentOrchestrator utilizes DynamicPlanner and populates non-empty targetFiles', () => {
  const orchestrator = new MultiAgentOrchestrator(
    {}, // mock provider
    { getAllTools: () => [], getDefinitions: () => [] }, // mock registry
    new PermissionManager('always_proceed')
  );

  const indexedFiles = [
    'src/server/routes/api.ts',
    'src/client/components/App.tsx',
    'tests/server/api.test.ts',
    'tests/client/app.test.ts'
  ];

  // Plan mode uses DynamicPlanner
  const planGraph = orchestrator.decomposeGoal('Implement secure API authentication', 'plan', { indexedFiles });
  const planNodes = planGraph.getAllNodes();
  assert.ok(planNodes.length >= 3);
  assert.ok(planNodes.some((n) => n.targetFiles.length > 0));

  // Autonomous agent mode produces dynamic multi-agent DAG with targeted files
  const agentGraph = orchestrator.decomposeGoal('Fullstack authentication system with api and ui', 'agent', { indexedFiles });
  const agentNodes = agentGraph.getAllNodes();
  assert.ok(agentNodes.length >= 4);

  // Target files must not be empty across all mutating nodes
  const coderNodes = agentNodes.filter((n) => n.role === 'coder');
  assert.ok(coderNodes.length >= 1);
  for (const coder of coderNodes) {
    assert.ok(coder.targetFiles.length > 0, `Coder node "${coder.title}" should have predicted targetFiles`);
  }
});

test('PermissionManager integrates PolicyBroker and rejects security violations', async () => {
  const permissions = new PermissionManager('always_proceed');
  const broker = permissions.getPolicyBroker();
  assert.ok(broker instanceof PolicyBroker);

  // Traversal attack outside workspace boundary fails closed
  const deniedPath = await permissions.checkPermission(
    'write_file',
    { path: '../../../../Windows/System32/drivers/etc/hosts', content: 'malicious' },
    false,
    undefined,
    false,
    getBuiltinToolDescriptor('write_file')
  );
  assert.equal(deniedPath, false);

  // SSRF attempt fails closed
  const deniedUrl = await permissions.checkPermission(
    'read_web_page',
    { url: 'http://169.254.169.254/latest/meta-data/' },
    false,
    undefined,
    false,
    getBuiltinToolDescriptor('read_web_page')
  );
  assert.equal(deniedUrl, false);
});

test('ComputerUseManager executes observe-act-observe with receipt generation', async () => {
  const adapter = new MockDesktopAdapter();
  const manager = new ComputerUseManager({ adapter });
  manager.policy.grantCapability('MOUSE_CLICK');

  const preObs = await manager.observe('test-run');
  assert.ok(preObs.screenHash);

  const receipt = await manager.click('test-run', { x: 100, y: 100 }, preObs.screenHash);
  assert.equal(receipt.status, 'success');
  assert.equal(receipt.verificationResult, 'verified');
  assert.equal(receipt.actionType, 'click');
  assert.ok(receipt.id);
});

test('WorktreeManager detects clean branch status and manages preview merge', async () => {
  const path = require('node:path');
  const manager = new WorktreeManager(path.resolve('.'));
  const isRepo = await manager.isGitRepository();
  assert.equal(isRepo, true);

  const mockWorktree = {
    id: 'test-wt-1',
    runId: 'run-1',
    agentId: 'agent-1',
    branchName: 'HEAD',
    worktreePath: path.resolve('.'),
    createdAt: Date.now()
  };
  const preview = await manager.previewMerge(mockWorktree);
  assert.equal(preview.hasConflict, false);
});
