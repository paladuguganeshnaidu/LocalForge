const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.apply(this, arguments);
};
const { TerminalManager } = require('../dist/terminal/terminalManager.js');

test('TerminalManager executes a real cross-platform Node process and captures output', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-terminal-'));
  try {
    await fs.writeFile(path.join(dir, 'smoke.js'), 'console.log("LocalForge working");');
    const manager = new TerminalManager();
    const command = JSON.stringify(process.execPath) + ' smoke.js';
    for (let i = 0; i < 10; i += 1) {
      const result = await manager.runCommand(command, dir, false, 15000);
      assert.equal(result.status, 'completed');
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /LocalForge working/);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
