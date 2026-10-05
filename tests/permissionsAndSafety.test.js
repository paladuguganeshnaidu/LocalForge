const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');

test('explicit workspace-session approval covers changing ordinary commands and edits but not new registrations or protected actions', async () => {
  let requests = 0;
  const registry = new ToolRegistry();
  const definition = name => ({ type: 'function', function: { name, description: 'Executable permission fixture', parameters: {} } });
  for (const name of ['run_command', 'create_file', 'delete_file', 'read_web_page']) registry.registerTool(definition(name), async () => ({ success: true }));
  const permissions = new PermissionManager('always_ask', async () => { requests += 1; return false; });
  permissions.grantWorkspaceSession(registry.getAllTools().filter(tool => tool.source === 'builtin').map(tool => tool.authorizationId));
  assert.equal(permissions.shouldAutoApplyEdits(), true);
  await registry.executeTool('run_command', { command: 'node --test one.test.cjs' }, permissions);
  await registry.executeTool('run_command', { command: 'node --test two.test.cjs' }, permissions);
  await registry.executeTool('create_file', { path: 'new-file.cjs', content: 'module.exports = 1;' }, permissions);
  assert.equal(requests, 0);
  for (const command of ['git push', 'sudo node app.cjs', 'curl https://example.com', 'npm install', 'rm important.txt']) await assert.rejects(registry.executeTool('run_command', { command }, permissions), /rejected/);
  await assert.rejects(registry.executeTool('delete_file', { path: 'important.txt' }, permissions), /rejected/);
  await assert.rejects(registry.executeTool('read_web_page', { url: 'https://example.com' }, permissions), /rejected/);
  registry.replaceTool(definition('run_command'), async () => ({ success: true }));
  await assert.rejects(registry.executeTool('run_command', { command: 'node --test new.test.cjs' }, permissions), /rejected/);
  permissions.clearSession();
  assert.equal(permissions.shouldAutoApplyEdits(), false);
  await assert.rejects(registry.executeTool('create_file', { path: 'another.cjs', content: 'module.exports = 2;' }, permissions), /rejected/);
  assert.equal(requests, 9);
});

test('session grants cannot authorize Full Machine or survive a changed approval mode', () => {
  const { AgentAccessPolicy } = require('../dist/agent/accessPolicy');
  const policy = new AgentAccessPolicy();
  const permissions = new PermissionManager();
  permissions.setAccessPolicy(policy);
  permissions.grantWorkspaceSession(['registration-1']);
  permissions.setMode('always_ask');
  assert.equal(permissions.hasWorkspaceSessionApproval(), false);
  policy.setScope('machine');
  assert.throws(() => permissions.grantWorkspaceSession(['registration-1']), /project workspace/);
});

test('destructive tool metadata requires explicit approval even in automatic modes', async () => {
  for (const mode of ['request_review', 'allow_safe_auto', 'always_proceed']) {
    let executions = 0;
    let requests = 0;
    const registry = new ToolRegistry();
    registry.registerTool({ type: 'function', function: { name: 'delete_file', description: 'Delete a recorded test file', parameters: {} } },
      async () => { executions += 1; }, { category: 'edit', riskLevel: 'destructive', requiresApproval: true });
    const permissions = new PermissionManager(mode, async () => { requests += 1; return false; });
    await assert.rejects(registry.executeTool('delete_file', { path: 'safe.txt' }, permissions), /rejected/);
    assert.equal(requests, 1);
    assert.equal(executions, 0);
  }
});

test('approval for one rollback ID does not authorize another recovery record', async () => {
  let requests = 0;
  const permissions = new PermissionManager('ask_once_per_session', async () => { requests += 1; return true; });
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'rollback_changes', description: 'Restore a recorded edit', parameters: {} } },
    async () => ({ success: true }), { category: 'edit', riskLevel: 'destructive', requiresApproval: true });
  await registry.executeTool('rollback_changes', { recoveryId: 'one' }, permissions);
  await registry.executeTool('rollback_changes', { recoveryId: 'one' }, permissions);
  await registry.executeTool('rollback_changes', { recoveryId: 'two' }, permissions);
  assert.equal(requests, 2);
});

test('invalid truthy approval results cannot grant permission', async () => {
  for (const decision of ['deny', 'allow', 'true', {}, 1]) {
    const permissions = new PermissionManager('always_ask', async () => decision);
    assert.equal(await permissions.checkPermission('delete_file', { path: 'protected.txt' }), false);
  }
});

test('PermissionManager classifies tools correctly into read, edit, execute', () => {
  const pm = new PermissionManager();
  assert.equal(pm.classifyTool('read_workspace_file'), 'read');
  assert.equal(pm.classifyTool('search_workspace'), 'read');
  assert.equal(pm.classifyTool('list_directory'), 'read');
  assert.equal(pm.classifyTool('write_workspace_file'), 'edit');
  assert.equal(pm.classifyTool('edit_workspace_file'), 'edit');
  assert.equal(pm.classifyTool('run_command'), 'execute');
});

test('PermissionManager blocks catastrophic shell commands', () => {
  const pm = new PermissionManager();
  assert.throws(() => pm.validateCommandSafety('rm -rf /'), /catastrophic/);
  assert.throws(() => pm.validateCommandSafety('del /s /q c:\\'), /catastrophic/);
  assert.throws(() => pm.validateCommandSafety('mkfs /dev/sda1'), /catastrophic/);
  assert.throws(() => pm.validateCommandSafety(':(){ :|:& };:'), /catastrophic/);
});

test('PermissionManager allows file inspection but requires approval for repository-controlled test/build commands', async () => {
  const pm = new PermissionManager('allow_safe_auto');
  assert.equal(pm.isSafeCommand('npm test'), false);
  assert.equal(pm.isSafeCommand('git status'), true);
  assert.equal(pm.isSafeCommand('cargo test'), false);
  assert.equal(pm.isSafeCommand('npm run build'), false);

  const readAllowed = await pm.checkPermission('read_workspace_file', { path: 'src/index.ts' });
  assert.equal(readAllowed, true);

  const testCmdAllowed = await pm.checkPermission('run_command', { command: 'npm test' });
  assert.equal(testCmdAllowed, false);
});

test('PermissionManager requests approval for execute tools when handler is set', async () => {
  const requests = [];
  const pm = new PermissionManager('always_ask', async (req) => {
    requests.push(req);
    return true;
  });

  const allowed = await pm.checkPermission('run_command', { command: 'npm run custom-script' });
  assert.equal(allowed, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].toolName, 'run_command');
  assert.equal(requests[0].command, 'npm run custom-script');
});

test('always_ask lets read-only inspection run but asks before edits and commands', async () => {
  const requests = [];
  const pm = new PermissionManager('always_ask', async (request) => {
    requests.push(request.toolName);
    return true;
  });

  assert.equal(await pm.checkPermission('read_workspace_file', { path: 'src/index.ts' }), true);
  assert.equal(await pm.checkPermission('edit_workspace_file', { path: 'src/index.ts' }), true);
  assert.equal(await pm.checkPermission('run_command', { command: 'npm test' }), true);
  assert.deepEqual(requests, ['edit_workspace_file', 'run_command']);
});

test('session approvals are revoked when the active session changes', async () => {
  let approvalCount = 0;
  const pm = new PermissionManager('ask_once_per_session', async () => {
    approvalCount += 1;
    return true;
  });

  assert.equal(await pm.checkPermission('run_command', { command: 'npm run custom-check' }), true);
  assert.equal(await pm.checkPermission('run_command', { command: 'npm run custom-check' }), true);
  assert.equal(approvalCount, 1);

  pm.clearSession();
  assert.equal(await pm.checkPermission('run_command', { command: 'npm run custom-check' }), true);
  assert.equal(approvalCount, 2);
});

test('always_ask trusts explicit built-in read-only metadata but not custom read labels', async () => {
  const requests = [];
  const permissions = new PermissionManager('always_ask', async (request) => {
    requests.push(request.toolName);
    return false;
  });
  const registry = new ToolRegistry();
  const definition = (name) => ({
    type: 'function',
    function: { name, description: 'Fixture tool', parameters: { type: 'object', properties: {} } }
  });

  registry.registerTool(definition('inspect_fixture'), async () => ({ ok: true }), {
    category: 'read', riskLevel: 'read_only', requiresApproval: false, source: 'builtin'
  });
  registry.registerTool(definition('inspect_custom_fixture'), async () => ({ ok: true }), {
    category: 'read', riskLevel: 'read_only', requiresApproval: false, source: 'custom'
  });

  assert.deepEqual(await registry.executeTool('inspect_fixture', {}, permissions), { ok: true });
  await assert.rejects(() => registry.executeTool('inspect_custom_fixture', {}, permissions), /rejected by user or permission policy/);
  assert.deepEqual(requests, ['inspect_custom_fixture']);
});
