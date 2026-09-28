const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PermissionManager } = require('../dist/agent/permissionManager.js');

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

test('PermissionManager allows safe inspection and test commands in allow_safe_auto mode', async () => {
  const pm = new PermissionManager('allow_safe_auto');
  assert.equal(pm.isSafeCommand('npm test'), true);
  assert.equal(pm.isSafeCommand('git status'), true);
  assert.equal(pm.isSafeCommand('cargo test'), true);
  assert.equal(pm.isSafeCommand('npm run build'), true);

  const readAllowed = await pm.checkPermission('read_workspace_file', { path: 'src/index.ts' });
  assert.equal(readAllowed, true);

  const testCmdAllowed = await pm.checkPermission('run_command', { command: 'npm test' });
  assert.equal(testCmdAllowed, true);
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
