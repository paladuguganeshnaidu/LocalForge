const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(process.env.LOCALFORGE_LANDING_ROOT || 'C:/Users/ganes/Documents/Codex/NexusFlow-agent-tests');
  const label = process.argv[2] || `chat-ui-${Date.now()}`;
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple unique run label.');
  const run = path.join(root, label);
  if (fs.existsSync(run)) throw new Error('Refusing to reuse an existing UI run.');
  const workspace = path.join(run, 'project');
  fs.mkdirSync(workspace, { recursive: true });
  const installed = path.resolve(process.env.LOCALFORGE_INSTALLED_PATH || 'C:/Users/ganes/.vscode/extensions/paladuguganeshnaidu.localforge-vscode-0.2.25');
  await runTests({
    vscodeExecutablePath: process.env.LOCALFORGE_VSCODE_EXECUTABLE || 'C:/Users/ganes/AppData/Local/Programs/Microsoft VS Code/Code.exe',
    extensionDevelopmentPath: installed,
    extensionTestsPath: path.resolve(__dirname, 'extensionHost/chatUiShowSuite.js'),
    launchArgs: [workspace, '--new-window', '--disable-gpu', '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${path.join(run, 'profile')}`],
    extensionTestsEnv: { LOCALFORGE_UI_RUN: run }
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
