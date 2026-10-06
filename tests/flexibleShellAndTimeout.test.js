const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        isTrusted: true,
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        asRelativePath: (p) => typeof p === 'string' ? p : (p?.fsPath || '')
      },
      Uri: {
        file: (p) => ({ fsPath: p }),
        joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath || base, ...segments) })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { ShellResolver } = require('../dist/terminal/shellResolver');
const { CommandTimeoutClassifier } = require('../dist/terminal/commandTimeoutClassifier');
const { TerminalManager } = require('../dist/terminal/terminalManager');

test('ShellResolver discovers host shells and detects bash syntax', () => {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const gitBash = ShellResolver.findGitBash();
    assert.ok(gitBash !== null, 'Git Bash must be discovered when installed on Windows');
    assert.ok(typeof gitBash === 'string');
    assert.match(gitBash, /bash\.exe$/i);

    const ps = ShellResolver.findPowerShell();
    assert.ok(ps !== null, 'PowerShell must be discovered on Windows');
    assert.match(ps, /powershell\.exe|pwsh\.exe$/i);
  }

  // Syntax detection
  assert.equal(ShellResolver.isBashCommand('export FOO=bar && echo $FOO'), true);
  assert.equal(ShellResolver.isBashCommand('source ./activate.sh'), true);
  assert.equal(ShellResolver.isBashCommand('#!/bin/bash\necho "script"'), true);
  assert.equal(ShellResolver.isBashCommand('chmod +x ./build.sh'), true);
  assert.equal(ShellResolver.isBashCommand('mkdir -p src/components/ui'), true);
  assert.equal(ShellResolver.isBashCommand('uname -a'), true);
  assert.equal(ShellResolver.isBashCommand('grep -rn "test" src/'), true);
  assert.equal(ShellResolver.isBashCommand('FOO=1 npm start'), true);

  // Standard non-bash commands
  assert.equal(ShellResolver.isBashCommand('npm test'), false);
  assert.equal(ShellResolver.isBashCommand('git status'), false);
  assert.equal(ShellResolver.isBashCommand('dir'), false);
});

test('ShellResolver resolves appropriate executable and args for shells', () => {
  const isWindows = process.platform === 'win32';

  // Explicit bash
  const resolvedBash = ShellResolver.resolve('bash', 'echo "hello from bash"');
  assert.equal(resolvedBash.type, 'bash');
  assert.equal(resolvedBash.isBash, true);
  assert.equal(resolvedBash.args[0], '-c');
  assert.equal(resolvedBash.args[1], 'echo "hello from bash"');

  // Explicit powershell
  const resolvedPs = ShellResolver.resolve('powershell', 'Get-ChildItem');
  assert.equal(resolvedPs.type, 'powershell');
  assert.equal(resolvedPs.args.includes('-NoProfile'), true);

  // Explicit cmd (Windows)
  if (isWindows) {
    const resolvedCmd = ShellResolver.resolve('cmd', 'dir');
    assert.equal(resolvedCmd.type, 'cmd');
    assert.equal(resolvedCmd.args[0], '/d');
  }

  // Auto mode on bash command
  const autoBash = ShellResolver.resolve('auto', 'export MY_VAR="test" && echo $MY_VAR');
  if (isWindows && ShellResolver.findGitBash()) {
    assert.equal(autoBash.type, 'bash');
    assert.equal(autoBash.isBash, true);
  }
});

test('TerminalManager executes real bash commands with POSIX environment', async () => {
  const manager = new TerminalManager();
  const cwd = process.cwd();

  // Run bash command explicitly requesting bash
  const proc = await manager.runCommand(
    'export GREETING="Hello_From_TuxNest_Bash" ; echo "$GREETING"',
    cwd,
    false,
    60000,
    undefined,
    { shell: 'bash' }
  );

  assert.equal(proc.status, 'completed');
  assert.equal(proc.exitCode, 0);
  assert.match(proc.stdout, /Hello_From_TuxNest_Bash/);
  assert.ok(proc.shell.toLowerCase().includes('bash'));
});

test('TerminalManager auto-detects bash command and executes cleanly', async () => {
  const manager = new TerminalManager();
  const cwd = process.cwd();

  // In auto mode, command with export and bash syntax routes to bash
  const proc = await manager.runCommand(
    'export AUTO_TEST="Auto_Bash_Success" ; echo "$AUTO_TEST"',
    cwd,
    false,
    60000,
    undefined,
    { shell: 'auto' }
  );

  assert.equal(proc.status, 'completed');
  assert.equal(proc.exitCode, 0);
  assert.match(proc.stdout, /Auto_Bash_Success/);
});

test('CommandTimeoutClassifier categorizes commands with adaptive ceilings', () => {
  // 1. Package installation commands
  const npmInstall = CommandTimeoutClassifier.classify('npm install --save react react-dom');
  assert.equal(npmInstall.category, 'install');
  assert.equal(npmInstall.maxTimeoutMs, 600000); // 10 minutes
  assert.equal(npmInstall.inactivityTimeoutMs, 120000); // 2 minutes

  const pipInstall = CommandTimeoutClassifier.classify('pip install -r requirements.txt');
  assert.equal(pipInstall.category, 'install');
  assert.equal(pipInstall.maxTimeoutMs, 600000);

  const cargoBuild = CommandTimeoutClassifier.classify('cargo build --release');
  assert.equal(cargoBuild.category, 'install');
  assert.equal(cargoBuild.maxTimeoutMs, 600000);

  const yarnAdd = CommandTimeoutClassifier.classify('yarn add typescript @types/node');
  assert.equal(yarnAdd.category, 'install');
  assert.equal(yarnAdd.maxTimeoutMs, 600000);

  // 2. Build and test commands
  const npmBuild = CommandTimeoutClassifier.classify('npm run build');
  assert.equal(npmBuild.category, 'build_test');
  assert.equal(npmBuild.maxTimeoutMs, 300000); // 5 minutes
  assert.equal(npmBuild.inactivityTimeoutMs, 90000); // 1.5 minutes

  const tsc = CommandTimeoutClassifier.classify('tsc -p ./tsconfig.json');
  assert.equal(tsc.category, 'build_test');
  assert.equal(tsc.maxTimeoutMs, 300000);

  // 3. Standard commands
  const gitStatus = CommandTimeoutClassifier.classify('git status');
  assert.equal(gitStatus.category, 'standard');
  assert.equal(gitStatus.maxTimeoutMs, 120000); // 2 minutes
  assert.equal(gitStatus.inactivityTimeoutMs, 60000);

  // 4. Explicit caller override
  const shortTimeout = CommandTimeoutClassifier.classify('npm install', 200);
  assert.equal(shortTimeout.category, 'explicit');
  assert.equal(shortTimeout.maxTimeoutMs, 200);
  assert.equal(shortTimeout.inactivityTimeoutMs, 200);
});

test('TerminalManager activity watchdog extends running command when output is streaming', async () => {
  const manager = new TerminalManager();
  const cwd = process.cwd();

  // Run a command that outputs ticks every 150ms for 1200ms total
  // With inactivity timeout set to 800ms, it runs for >1200ms without timing out because output keeps resetting it
  const script = "let count = 0; const t = setInterval(() => { console.log('tick ' + count++); if (count >= 8) { clearInterval(t); process.exit(0); } }, 150);";
  const proc = await manager.runCommand(
    `node -e "${script}"`,
    cwd,
    false,
    10000,
    undefined,
    { inactivityTimeoutMs: 800 }
  );

  assert.equal(proc.status, 'completed');
  assert.equal(proc.exitCode, 0);
  assert.match(proc.stdout, /tick 7/);
});

test('TerminalManager times out when silent beyond inactivity timeout', async () => {
  const manager = new TerminalManager();
  const cwd = process.cwd();

  // Command that sleeps with 0 output
  const proc = await manager.runCommand(
    'node -e "setTimeout(() => {}, 5000)"',
    cwd,
    false,
    5000,
    undefined,
    { inactivityTimeoutMs: 250 }
  );

  assert.equal(proc.status, 'timed_out');
  assert.ok(proc.stderr.includes('timed out'));
});

test('coreTools run_command exposes shell and timeoutMs options and executes bash', async () => {
  const { ToolRegistry } = require('../dist/agent/toolRegistry');
  const { registerAllCoreTools } = require('../dist/agent/coreTools');
  const { PermissionManager } = require('../dist/agent/permissionManager');

  const registry = new ToolRegistry();
  const tm = new TerminalManager();
  registerAllCoreTools(registry, { terminalManager: tm });

  const tool = registry.getTool('run_command');
  assert.ok(tool, 'run_command must be registered');
  assert.equal(tool.timeout, 900000, 'run_command must have extended 15m timeout for installations');
  assert.ok(tool.definition.function.parameters.properties.shell, 'shell property must exist in schema');
  assert.ok(tool.definition.function.parameters.properties.timeoutMs, 'timeoutMs property must exist in schema');

  const permissions = new PermissionManager('always_ask', async () => true);
  const result = await registry.executeTool('run_command', {
    command: 'export TOOL_TEST="CoreToolBashSuccess" ; echo "$TOOL_TEST"',
    shell: 'bash'
  }, permissions);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /CoreToolBashSuccess/);
  assert.ok(result.shell.toLowerCase().includes('bash'));
});
