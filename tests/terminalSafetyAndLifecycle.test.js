const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TerminalManager } = require('../dist/terminal/terminalManager');
const { PermissionManager } = require('../dist/agent/permissionManager');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

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

test('agent terminals close stdin and use explicit noninteractive npm policy', async () => {
  const manager = new TerminalManager();
  const record = await manager.runCommand('node -e "process.stdin.on(\'end\',()=>console.log(JSON.stringify({ci:process.env.CI,yes:process.env.npm_config_yes})));process.stdin.resume()"', process.cwd());
  assert.equal(record.exitCode, 0);
  assert.deepEqual(JSON.parse(record.stdout.trim()), { ci: 'true', yes: 'false' });
});

test('known webpack CLI installation prompts stop promptly with actionable recovery', async () => {
  const manager = new TerminalManager();
  try {
    const execution = manager.runCommand('node -e "console.error(\'Do you want to install webpack-cli (yes/no):\');setInterval(()=>{},1000)"', process.cwd(), false, 30000);
    const started = Date.now();
    while (!manager.getAllProcesses()[0]?.stderr.includes('Do you want to install') && Date.now() - started < 30000) await new Promise(resolve => setTimeout(resolve, 10));
    const promptObservedAt = Date.now();
    assert.match(manager.getAllProcesses()[0]?.stderr || '', /Do you want to install/, 'The child must emit the prompt before timing its recovery');
    const record = await execution;
    assert.equal(record.status, 'stopped');
    assert.ok(record.endTime - promptObservedAt < 10000, 'Stop promptly after the actual prompt, excluding child startup delay under load');
    assert.match(record.stderr, /install_packages approval/);
    assert.equal(manager.getRunningProcesses().length, 0);
  } finally { await manager.stopAllProcesses(); }
});

test('TerminalManager captures non-zero exit codes on failed command', async () => {
  const tm = new TerminalManager();
  const cwd = process.cwd();

  const proc = await tm.runCommand('node -e "process.exit(42)"', cwd);

  assert.equal(proc.status, 'failed');
  assert.equal(proc.exitCode, 42);
});

test('background server starts reuse one owned process even across concurrent requests', async () => {
  const manager = new TerminalManager();
  const command = 'node -e "setInterval(() => {}, 1000)"';
  try {
    const [first, second] = await Promise.all([manager.startBackgroundCommand(command, process.cwd()), manager.startBackgroundCommand(command, process.cwd())]);
    assert.equal(first.status, 'running');
    assert.equal(second.id, first.id);
    assert.equal(second.reused, true);
    assert.equal(manager.getAllProcesses().length, 1);
    const third = await manager.startBackgroundCommand(command, process.cwd());
    assert.equal(third.id, first.id);
    assert.equal(third.reused, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(manager.startBackgroundCommand(command, process.cwd(), controller.signal), /abort/i);
    assert.equal(manager.getRunningProcesses().length, 1);
  } finally {
    await manager.stopAllProcesses();
  }
});

test('awaited shutdown terminates owned shell descendants and their HTTP listener, not unrelated listeners', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-owned-tree-'));
  const manager = new TerminalManager();
  const unrelated = http.createServer((_request, response) => response.end('UNRELATED_FIXTURE_ALIVE'));
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  try {
    const worker = path.join(directory, 'worker.cjs');
    const launcher = path.join(directory, 'launcher.cjs');
    await fs.writeFile(worker, "const http=require('node:http');const server=http.createServer((request,response)=>response.end('OWNED_TREE'));server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:server.address().port})));\n");
    await fs.writeFile(launcher, `require('node:child_process').spawn(process.execPath,[${JSON.stringify(worker)}],{stdio:'inherit'});\n`);
    const record = await manager.startBackgroundCommand(`node "${launcher}"`, directory);
    const deadline = Date.now() + 10000;
    const current = () => manager.getAllProcesses().find(candidate => candidate.id === record.id);
    while (!current().stdout.includes('\n') && current().status === 'running' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(current().stdout.includes('\n'), `Owned child did not start: ${JSON.stringify(current())}`);
    const child = JSON.parse(current().stdout.trim());
    const ownedUrl = `http://127.0.0.1:${child.port}`;
    assert.equal(await (await fetch(ownedUrl)).text(), 'OWNED_TREE');
    await manager.stopAllProcesses();
    assert.equal(manager.getRunningProcesses().length, 0);
    await assert.rejects(fetch(ownedUrl, { signal: AbortSignal.timeout(2000) }));
    assert.throws(() => process.kill(child.pid, 0));
    assert.equal(await (await fetch(`http://127.0.0.1:${unrelated.address().port}`)).text(), 'UNRELATED_FIXTURE_ALIVE');
  } finally {
    await manager.stopAllProcesses();
    unrelated.closeAllConnections();
    await new Promise(resolve => unrelated.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('background command failure remains visible in authoritative process status', async () => {
  const manager = new TerminalManager();
  const record = await manager.startBackgroundCommand('node -e "process.exit(42)"', process.cwd());
  const deadline = Date.now() + 15000;
  while (manager.getRunningProcesses().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  const final = manager.getAllProcesses().find(candidate => candidate.id === record.id);
  assert.equal(final.status, 'failed');
  assert.equal(final.exitCode, 42);
  assert.equal(manager.getRunningProcesses().length, 0);
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

  assert.equal(pm.isSafeCommand('npm test'), false);
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
