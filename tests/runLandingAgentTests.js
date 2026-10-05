const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(process.env.LOCALFORGE_LANDING_ROOT || 'C:/Users/ganes/Documents/Codex/NexusFlow-agent-tests');
  const label = process.argv[2] || `torii-${Date.now()}`;
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple unique run label.');
  const run = path.join(root, label);
  if (fs.existsSync(run)) throw new Error('Run directory already exists; refusing to reuse a non-clean workspace.');
  const resumeLabel = process.env.LOCALFORGE_LANDING_RESUME;
  if (resumeLabel && (!/^[a-z0-9-]+$/.test(resumeLabel) || !['minimal-repair', 'micro-repair', 'minimal-verify'].includes(process.env.LOCALFORGE_LANDING_PHASE))) throw new Error('Only an explicitly labelled owned minimal-site run may be resumed.');
  const workspace = resumeLabel ? path.join(root, resumeLabel, 'project') : path.join(run, 'project');
  fs.mkdirSync(run, { recursive: true });
  if (resumeLabel) {
    const previous = JSON.parse(fs.readFileSync(path.join(root, resumeLabel, 'result.json'), 'utf8'));
    if (path.resolve(previous.workspace).toLowerCase() !== workspace.toLowerCase() || JSON.stringify(fs.readdirSync(workspace)) !== '["index.html"]') throw new Error('Resume requires the recorded owned single-file website workspace.');
  } else fs.mkdirSync(workspace, { recursive: true });
  const installed = path.resolve(process.env.LOCALFORGE_INSTALLED_PATH || 'C:/Users/ganes/.vscode/extensions/paladuguganeshnaidu.localforge-vscode-0.2.25');
  fs.writeFileSync(path.join(run, 'environment.json'), JSON.stringify({ createdAt: new Date().toISOString(), installed, workspace, initialFiles: fs.readdirSync(workspace), node: process.version, platform: process.platform }, null, 2));
  try { await runTests({
    vscodeExecutablePath: process.env.LOCALFORGE_VSCODE_EXECUTABLE || 'C:/Users/ganes/AppData/Local/Programs/Microsoft VS Code/Code.exe',
    extensionDevelopmentPath: installed,
    extensionTestsPath: path.resolve(__dirname, 'extensionHost/landingAgentSuite.js'),
    launchArgs: [workspace, '--new-window', '--disable-gpu', '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${path.join(run, 'profile')}`],
    extensionTestsEnv: {
      LOCALFORGE_AGENT_NODE_BINARY: process.execPath,
      LOCALFORGE_LANDING_RUN: run,
      LOCALFORGE_LANDING_WORKSPACE: workspace,
      LOCALFORGE_LANDING_RESUME: resumeLabel || '',
      LOCALFORGE_LANDING_MODEL: process.env.LOCALFORGE_LANDING_MODEL || 'qwen2.5-coder:1.5b',
      LOCALFORGE_LANDING_PHASE: process.env.LOCALFORGE_LANDING_PHASE || 'website',
      LOCALFORGE_LANDING_TIMEOUT_MINUTES: process.env.LOCALFORGE_LANDING_TIMEOUT_MINUTES || '15',
      LOCALFORGE_KEEP_WEBSITE: process.env.LOCALFORGE_KEEP_WEBSITE || '0',
      LOCALFORGE_LANDING_SSH_PROFILE: process.env.LOCALFORGE_LANDING_SSH_PROFILE || '',
      LOCALFORGE_LANDING_PORT: process.env.LOCALFORGE_LANDING_PORT || '',
      LOCALFORGE_LANDING_CONTEXT_TOKENS: process.env.LOCALFORGE_LANDING_CONTEXT_TOKENS || '',
      LOCALFORGE_LANDING_TEMPERATURE: process.env.LOCALFORGE_LANDING_TEMPERATURE || '',
      LOCALFORGE_LANDING_EFFORT: process.env.LOCALFORGE_LANDING_EFFORT || '',
      LOCALFORGE_LANDING_THINKING: process.env.LOCALFORGE_LANDING_THINKING || ''
    }
  }); } catch (error) {
    fs.writeFileSync(path.join(run, 'driver-error.json'), JSON.stringify({ finishedAt: new Date().toISOString(), error: error.stack || String(error) }, null, 2));
    throw error;
  }
  console.log(`Landing-agent evidence retained: ${run}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
