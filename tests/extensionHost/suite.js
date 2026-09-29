const assert = require('assert');
const vscode = require('vscode');

async function run() {
  console.log('[ExtensionHost] Starting Extension Host verification...');

  // 1. Extension activation
  const ext = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
  assert.ok(ext, 'Extension paladuguganeshnaidu.localforge-vscode must be discovered');

  if (!ext.isActive) {
    console.log('[ExtensionHost] Activating extension...');
    await ext.activate();
  }
  assert.strictEqual(ext.isActive, true, 'Extension must be active');
  console.log('[ExtensionHost] PASS: Extension activated successfully.');

  // 2. Command registration verification
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

  const registeredCommands = await vscode.commands.getCommands(true);
  for (const cmd of expectedCommands) {
    assert.ok(
      registeredCommands.includes(cmd),
      `Command "${cmd}" must be registered in the extension host.`
    );
  }
  console.log(`[ExtensionHost] PASS: All ${expectedCommands.length} commands verified registered.`);

  // 3. Command execution verification (diagnose, doctor, selfTest)
  await vscode.commands.executeCommand('localforge.diagnose');
  console.log('[ExtensionHost] PASS: localforge.diagnose executed without error.');

  await vscode.commands.executeCommand('localforge.doctor');
  console.log('[ExtensionHost] PASS: localforge.doctor executed without error.');

  await vscode.commands.executeCommand('localforge.selfTest');
  console.log('[ExtensionHost] PASS: localforge.selfTest executed without error.');

  // 4. Mode and model switching commands
  await vscode.commands.executeCommand('localforge.setAgentMode', 'ask');
  await vscode.commands.executeCommand('localforge.setAgentMode', 'plan');
  await vscode.commands.executeCommand('localforge.setAgentMode', 'agent');
  console.log('[ExtensionHost] PASS: setAgentMode executed for all modes.');

  // 5. Terminal execution in host
  const { TerminalManager } = require('../../dist/terminal/terminalManager.js');
  const terminal = new TerminalManager();
  const proc = await terminal.runCommand('node -e "console.log(\'ExtensionHostTerminalOK\')"', process.cwd(), false, 10000);
  assert.strictEqual(proc.status, 'completed');
  assert.ok(proc.stdout.includes('ExtensionHostTerminalOK'));
  console.log('[ExtensionHost] PASS: Managed terminal executed successfully in host.');

  // 6. Workspace file creation and verification
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(process.cwd());
  const testFileUri = vscode.Uri.joinPath(workspaceRoot, '.localforge_host_test.txt');
  await vscode.workspace.fs.writeFile(testFileUri, Buffer.from('ExtensionHostFsVerified\n', 'utf8'));
  const content = await vscode.workspace.fs.readFile(testFileUri);
  assert.ok(Buffer.from(content).toString('utf8').includes('ExtensionHostFsVerified'));
  await vscode.workspace.fs.delete(testFileUri);
  console.log('[ExtensionHost] PASS: Real workspace file operations verified in host.');

  // 7. Cancellation handling
  await vscode.commands.executeCommand('localforge.cancelAgent');
  console.log('[ExtensionHost] PASS: Cancellation command verified.');

  console.log('[ExtensionHost] ALL EXTENSION HOST INTEGRATION TESTS PASSED CLEANLY.');
}

module.exports = { run };
