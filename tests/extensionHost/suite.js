const assert = require('assert');
const vscode = require('vscode');

async function runStage(stageName, fn) {
  const start = Date.now();
  console.log(`[ExtensionHost] >>> Running stage: ${stageName}`);
  try {
    await fn();
    console.log(`[ExtensionHost] PASS: ${stageName} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[ExtensionHost] FAIL in stage "${stageName}":`, err);
    throw err;
  }
}

async function run() {
  console.log('=====================================================');
  console.log('  LOMVREN Extension Host Verification Suite');
  console.log('=====================================================');

  let ext;

  // Stage 1: Extension Discovery & Activation
  await runStage('Stage 1: Extension Activation', async () => {
    ext = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
    assert.ok(ext, 'Extension paladuguganeshnaidu.localforge-vscode must be discovered');

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, 'Extension must be active');
  });

  // Stage 2: Command Registration
  const expectedCommands = [
    'localforge.openAgent',
    'localforge.newConversation',
    'localforge.continueTask',
    'localforge.reviewChanges',
    'localforge.showArtifacts',
    'localforge.diagnose',
    'localforge.doctor',
    'localforge.selfTest',
    'localforge.refreshModels',
    'localforge.connectRemote',
    'localforge.disconnectRemote',
    'localforge.remoteGpuStatus',
    'localforge.reindexWorkspace',
    'localforge.cancelAgent',
    'localforge.setAgentMode',
    'localforge.setModel'
  ];

  await runStage('Stage 2: Command Registration Verification', async () => {
    const registeredCommands = await vscode.commands.getCommands(true);
    for (const cmd of expectedCommands) {
      assert.ok(
        registeredCommands.includes(cmd),
        `Command "${cmd}" must be registered in the extension host.`
      );
    }
  });

  // Stage 3: Built-in Command Executions
  await runStage('Stage 3A: localforge.diagnose execution', async () => {
    await vscode.commands.executeCommand('localforge.diagnose');
  });

  await runStage('Stage 3B: localforge.doctor execution', async () => {
    await vscode.commands.executeCommand('localforge.doctor');
  });

  await runStage('Stage 3C: localforge.selfTest execution', async () => {
    await vscode.commands.executeCommand('localforge.selfTest');
  });

  // Stage 4: Agent Mode Switching
  await runStage('Stage 4: Agent Mode Switching (Ask / Plan / Agent)', async () => {
    await vscode.commands.executeCommand('localforge.setAgentMode', 'ask');
    await vscode.commands.executeCommand('localforge.setAgentMode', 'plan');
    await vscode.commands.executeCommand('localforge.setAgentMode', 'agent');
  });

  // Stage 5: Managed Terminal Execution
  await runStage('Stage 5: Managed Terminal Execution', async () => {
    const { TerminalManager } = require('../../dist/terminal/terminalManager.js');
    const terminal = new TerminalManager();
    const proc = await terminal.runCommand('node -e "console.log(\'ExtensionHostTerminalOK\')"', process.cwd(), false, 10000);
    assert.strictEqual(proc.status, 'completed');
    assert.ok(proc.stdout.includes('ExtensionHostTerminalOK'));
  });

  // Stage 6: Workspace Filesystem Operations
  await runStage('Stage 6: Real Workspace File Operations', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(process.cwd());
    const testFileUri = vscode.Uri.joinPath(workspaceRoot, '.localforge_host_test.txt');
    await vscode.workspace.fs.writeFile(testFileUri, Buffer.from('ExtensionHostFsVerified\n', 'utf8'));
    const content = await vscode.workspace.fs.readFile(testFileUri);
    assert.ok(Buffer.from(content).toString('utf8').includes('ExtensionHostFsVerified'));
    await vscode.workspace.fs.delete(testFileUri);
  });

  // Stage 7: Cooperative Cancellation
  await runStage('Stage 7: Cancellation Command Verification', async () => {
    await vscode.commands.executeCommand('localforge.cancelAgent');
  });

  // Stage 8: Webview LifeCycle & IPC Message Flow
  await runStage('Stage 8: Webview LifeCycle and IPC Flow', async () => {
    const api = ext.exports;
    assert.ok(api, 'Extension must export API');
    assert.ok(api.engine, 'Extension API must expose engine');
    assert.ok(api.viewProvider, 'Extension API must expose viewProvider');

    let messageHandler;
    const webviewEvents = [];
    const mockWebview = {
      options: {},
      html: '',
      cspSource: 'https://*.vscode-cdn.net',
      asWebviewUri: (uri) => uri,
      postMessage: async (msg) => {
        webviewEvents.push(msg);
      },
      onDidReceiveMessage: (handler) => {
        messageHandler = handler;
        return { dispose: () => {} };
      }
    };

    api.viewProvider.resolveWebviewView({ webview: mockWebview });
    assert.ok(typeof messageHandler === 'function', 'Webview view must attach onDidReceiveMessage handler');

    await messageHandler({ type: 'ready' });
    assert.ok(webviewEvents.some((e) => e.type === 'models'), 'Webview should receive models on ready');

    await messageHandler({
      type: 'chat',
      model: 'auto',
      prompt: 'test prompt from extension host',
      includeContext: true,
      includeWorkspace: true,
      agentMode: false
    });
  });

  console.log('=====================================================');
  console.log('  ALL 8 EXTENSION HOST INTEGRATION STAGES PASSED');
  console.log('=====================================================');
}

module.exports = { run };
