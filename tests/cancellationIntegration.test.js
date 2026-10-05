const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { TerminalManager } = require('../dist/terminal/terminalManager.js');
const { BrowserTool } = require('../dist/browser/browserTool.js');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.apply(this, arguments);
};
const { ValidationEngine } = require('../dist/agent/validationEngine.js');
Module._load = originalLoad;

test('cancelling validation terminates its actual command before a delayed file write', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-cancel-'));
  const script = path.join(directory, 'child.cjs');
  const marker = path.join(directory, 'late-write.txt');
  fs.writeFileSync(script, 'const fs = require("node:fs"); console.log("READY " + process.pid); const poll = setInterval(() => { if (fs.existsSync("arm.txt")) { clearInterval(poll); setTimeout(() => fs.writeFileSync("late-write.txt", "unexpected"), 15000); } }, 20); setInterval(() => {}, 100);');
  const manager = new TerminalManager();
  const registry = new ToolRegistry();
  const validation = new ValidationEngine(manager);
  const controller = new AbortController();
  registry.registerTool({ type: 'function', function: {
    name: 'run_command', description: 'Run isolated cancellation test', parameters: {}
  } }, async (_args, execution) => validation.runValidation({ fsPath: directory }, `"${process.execPath}" "${script}"`, 10000, execution.signal));
  const result = registry.executeTool('run_command', {}, new PermissionManager('always_ask', async () => true), { signal: controller.signal })
    .then(() => ({ resolved: true }), (error) => ({ error }));
  try {
    const started = Date.now();
    while (!manager.getAllProcesses()[0]?.stdout.includes('READY') && Date.now() - started < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.match(manager.getAllProcesses()[0]?.stdout || '', /READY/, 'The child must actually start before cancellation');
    const childPid = Number(manager.getAllProcesses()[0].stdout.match(/READY (\d+)/)[1]);
    fs.writeFileSync(path.join(directory, 'arm.txt'), 'start');
    controller.abort();
    assert.equal((await result).error?.name, 'AbortError');
    assert.ok(['stopping', 'stopped'].includes(manager.getAllProcesses()[0].status));
    let alive = true;
    const stoppedAt = Date.now();
    while (alive && Date.now() - stoppedAt < 10000) {
      try { process.kill(childPid, 0); }
      catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      if (alive) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(alive, false, 'The actual child process must have exited, not merely be labelled stopped');
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal(fs.existsSync(marker), false, 'The cancelled process tree must not continue writing files');
  } finally {
    controller.abort();
    for (const record of manager.getAllProcesses()) manager.stopProcess(record.id);
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cancelling browser inspection closes the real HTTP request', async () => {
  let requested;
  let closed;
  const requestStarted = new Promise((resolve) => { requested = resolve; });
  const requestClosed = new Promise((resolve) => { closed = resolve; });
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.write('<html><title>Pending response</title>');
    response.on('close', () => closed(true));
    requested();
  });
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise((resolve, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(49152 + require('node:crypto').randomInt(16384), '127.0.0.1', () => { server.removeListener('error', onError); resolve(); });
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || attempt >= 19) throw error;
    }
  }
  const controller = new AbortController();
  const browser = new BrowserTool();
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: {
    name: 'browser_action', description: 'Inspect an isolated local endpoint', parameters: {}
  } }, (args, execution) => browser.execute(args, execution.signal));
  const inspection = registry.executeTool('browser_action', {
    action: 'navigate', url: `http://127.0.0.1:${server.address().port}/`
  }, new PermissionManager('always_ask', async () => true), { signal: controller.signal, timeoutMs: 10000 });
  try {
    await Promise.race([requestStarted, inspection.then(result => { throw new Error('Browser inspection finished before the controlled HTTP request started: ' + JSON.stringify(result)); })]);
    controller.abort();
    await assert.rejects(inspection, (error) => error.name === 'AbortError');
    const disconnected = await Promise.race([requestClosed, new Promise((resolve) => setTimeout(() => resolve(false), 1000))]);
    assert.equal(disconnected, true);
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
