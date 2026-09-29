const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TerminalManager } = require('../dist/terminal/terminalManager');
const { PermissionManager } = require('../dist/agent/permissionManager');

test('TerminalManager executes command and captures exit code, stdout, and duration', async () => {
  const tm = new TerminalManager();
  const cwd = process.cwd();

  const proc = await tm.runCommand('node -e "console.log(\'Terminal working\')"', cwd);

  assert.equal(proc.status, 'completed');
  assert.equal(proc.exitCode, 0);
  assert.ok(proc.stdout.includes('Terminal working'));
  assert.ok(typeof proc.duration === 'number');
  assert.ok(proc.processId !== undefined);
});

test('TerminalManager captures non-zero exit codes on failed command', async () => {
  const tm = new TerminalManager();
  const cwd = process.cwd();

  const proc = await tm.runCommand('node -e "process.exit(42)"', cwd);

  assert.equal(proc.status, 'failed');
  assert.equal(proc.exitCode, 42);
});

test('TerminalManager handles timeout correctly', async () => {
  const tm = new TerminalManager();
  const cwd = process.cwd();

  const proc = await tm.runCommand('node -e "setTimeout(() => {}, 5000)"', cwd, false, 200);

  assert.equal(proc.status, 'timed_out');
  assert.ok(proc.stderr.includes('timed out'));
});

test('PermissionManager blocks shell chaining and redirection in auto-safe mode', () => {
  const pm = new PermissionManager('allow_safe_auto');

  assert.equal(pm.isSafeCommand('npm test'), true);
  assert.equal(pm.isSafeCommand('npm test && rm -rf /'), false);
  assert.equal(pm.isSafeCommand('npm test || echo bad'), false);
  assert.equal(pm.isSafeCommand('npm test; rm file'), false);
  assert.equal(pm.isSafeCommand('npm test > output.txt'), false);
  assert.equal(pm.isSafeCommand('npm test | grep pass'), false);
  assert.equal(pm.isSafeCommand('npm test $(cat secret)'), false);
  assert.equal(pm.isSafeCommand('npm test `cat secret`'), false);
});

test('PermissionManager blocks destructive commands outright', () => {
  const pm = new PermissionManager('always_proceed');

  assert.throws(() => pm.validateCommandSafety('rm -rf /'), /blocked by policy/);
  assert.throws(() => pm.validateCommandSafety('del /f /s /q c:\\'), /blocked by policy/);
  assert.throws(() => pm.validateCommandSafety('format d:'), /blocked by policy/);
  assert.throws(() => pm.validateCommandSafety('shutdown -s'), /blocked by policy/);
});
