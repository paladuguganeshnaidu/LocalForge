const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { packageInstallCommand } = require('../dist/agent/packageInstall');
const { formatCommandLabel } = require('../dist/core/activityDetails');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');

test('package installation builds exact bounded registry commands without shell arguments', () => {
  const args = { packages: ['webpack@5.111.1', '@scope/tool@^2.0.0', 'webpack@5.111.1'], dev: true };
  const expected = 'npm install --save-dev -- "webpack@5.111.1" "@scope/tool@^2.0.0"';
  assert.equal(packageInstallCommand(args), expected);
  assert.equal(formatCommandLabel('install_packages', args), expected);
  assert.equal(packageInstallCommand({ packages: ['three@latest'] }), 'npm install --save-prod -- "three@latest"');
  for (const packages of [[], Array(21).fill('three'), ['--global'], ['file:../outside'], ['https://example.test/a.tgz'], ['pkg;echo bad'], ['pkg" && echo bad'], ['pkg@>=1'], ['pkg@1 2'], [null]]) assert.throws(() => packageInstallCommand({ packages }));
  assert.throws(() => packageInstallCommand({ packages: ['three'], dev: 'true' }));
});

test('registered installation requires exact network approval and rejects manifest drift', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-package-recovery-'));
  const vscode = { Uri: { joinPath: (root, ...segments) => ({ fsPath: path.join(root.fsPath, ...segments) }) }, workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: directory } }], fs: { readFile: uri => fs.readFile(uri.fsPath) } } };
  const originalLoad = Module._load;
  Module._load = function(request, ...args) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args); };
  let registerProjectTools;
  try { ({ registerProjectTools } = require('../dist/agent/projectTools')); } finally { Module._load = originalLoad; }
  const manifest = { name: 'fixture', scripts: { preinstall: 'node lifecycle.cjs', build: 'node build.cjs' } };
  const manifestPath = path.join(directory, 'package.json');
  let executions = 0;
  const registry = new ToolRegistry();
  registerProjectTools(registry, { runCommand: async (command, cwd) => { executions += 1; assert.equal(command, 'npm install --save-dev -- "webpack-cli@latest"'); assert.equal(cwd, directory); return { command, exitCode: 0 }; } });
  try {
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal(registry.getTool('install_packages').descriptor.network, true);
    const approve = new PermissionManager('always_proceed', async request => { assert.equal(request.command, 'npm install --save-dev -- "webpack-cli@latest"'); assert.equal(request.args.expandedScripts.preinstall, 'node lifecycle.cjs'); return true; });
    await registry.executeTool('install_packages', { packages: ['webpack-cli@latest'], dev: true }, approve);
    assert.equal(executions, 1);
    await assert.rejects(registry.executeTool('install_packages', { packages: ['webpack-cli@latest'], dev: true }, new PermissionManager('always_proceed', async () => false)), /rejected/);
    const drifting = new PermissionManager('always_proceed', async () => { await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, scripts: { preinstall: 'node changed.cjs' } })); return true; });
    await assert.rejects(registry.executeTool('install_packages', { packages: ['webpack-cli@latest'], dev: true }, drifting), /changed after approval/);
    assert.equal(executions, 1);
    await assert.rejects(registry.executeTool('install_packages', { packages: ['--global'] }, approve), /registry package/);
    assert.equal(executions, 1);
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('lomvren-package-recovery-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('process polling executes fresh inspections instead of cached results or false loop rejection', async () => {
  const registry = new ToolRegistry();
  let inspections = 0;
  registry.registerTool({ type: 'function', function: { name: 'process_status', description: 'Inspect tracked process', parameters: { type: 'object', properties: {} } } }, async () => [{ status: ++inspections < 5 ? 'running' : 'completed', exitCode: inspections < 5 ? undefined : 0 }]);
  let turns = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    if (turns++) assert.equal(JSON.parse(messages.at(-1).content)[0].status, turns <= 5 ? 'running' : 'completed');
    return turns <= 5 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'process_status', arguments: {} } }] } : { role: 'assistant', content: 'Process completed.' };
  } };
  const result = await new AgentLoop(provider, registry).run('fixture', [{ role: 'user', content: 'Wait for the owned command to finish.' }]);
  assert.equal(inspections, 5);
  assert.equal(result.state.status, 'completed');
});

test('a successful declared build resolves earlier equivalent build failures but not unrelated command errors', async () => {
  for (const failedCommand of ['npx webpack', 'npm run build', 'python train.py']) {
    const registry = new ToolRegistry();
    registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }, async () => ({ exitCode: 1, stderr: 'Command failed' }));
    registry.registerTool({ type: 'function', function: { name: 'run_build', description: 'Build project', parameters: { type: 'object', properties: {} } } }, async () => ({ command: 'npm run build', exitCode: 0 }));
    let turn = 0;
    const provider = { id: 'fixture', chatWithTools: async () => ++turn === 1 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_command', arguments: { command: failedCommand } } }] } : turn === 2 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_build', arguments: {} } }] } : { role: 'assistant', content: 'Build result inspected.' } };
    const result = await new AgentLoop(provider, registry, new PermissionManager('always_proceed', async () => true)).run('fixture', [{ role: 'user', content: 'Repair and build the project.' }]);
    assert.equal(result.state.unresolvedErrors.length, failedCommand === 'python train.py' ? 1 : 0);
    assert.equal(result.state.errors.length, 1, 'Historical failures remain in the audit trail');
  }
});
