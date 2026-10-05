const assert = require('node:assert/strict');
const { test } = require('node:test');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');

test('prepared real command/script details reach approval, execution and scoped registries', async () => {
  const registry = new ToolRegistry();
  let revision = 'first-script';
  let approvals = 0;
  let executions = 0;
  registry.registerTool({ type:'function', function:{ name:'run_build', description:'Run declared build', parameters:{ type:'object', properties:{} } } }, async (_args, context) => {
    assert.equal(context.approvedArguments.expandedScripts.build, revision);
    executions += 1;
    return { exitCode: 0 };
  }, { prepareApproval: async args => ({ ...args, command:'npm run build', expandedScripts:{ build:revision }, manifestHash: revision }) });
  const permissions = new PermissionManager('ask_once_per_session', async request => { approvals += 1; assert.equal(request.command,'npm run build'); assert.equal(request.args.expandedScripts.build,revision); return true; });
  await registry.executeTool('run_build', {}, permissions);
  await registry.executeTool('run_build', {}, permissions);
  assert.equal(approvals,1);
  revision = 'changed-script';
  await registry.createScopedRegistry(['execute']).executeTool('run_build', {}, permissions);
  assert.equal(approvals,2);
  assert.equal(executions,3);
});

test('denied prepared build approval cannot dispatch an executable handler', async () => {
  const registry = new ToolRegistry();
  let ran = false;
  registry.registerTool({ type:'function', function:{ name:'run_build', description:'Run declared build', parameters:{} } }, async () => { ran=true; }, { prepareApproval: async () => ({ command:'npm run build' }) });
  await assert.rejects(registry.executeTool('run_build', {}, new PermissionManager('always_proceed', async () => false)), /rejected/);
  assert.equal(ran,false);
});
