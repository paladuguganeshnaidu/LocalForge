const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-chat-restart-'));
  const workspace = path.join(fixture, 'project');
  fs.mkdirSync(workspace);
  try {
    const phases = process.argv.includes('--live-edit') ? ['live-edit'] : process.argv.includes('--live-memory') ? ['live-memory'] : process.argv.includes('--chat-memory') ? ['memory-prepare', 'memory-verify'] : process.argv.includes('--live-greeting') ? ['greeting'] : ['prepare', 'modify', 'verify'];
    for (const phase of phases) {
      await runTests({
        vscodeExecutablePath: process.env.LOCALFORGE_VSCODE_EXECUTABLE || undefined,
        extensionDevelopmentPath: path.resolve(__dirname, '..'),
        extensionTestsPath: path.resolve(__dirname, 'extensionHost', 'chatRestartSuite.js'),
        launchArgs: [workspace, '--new-window', '--disable-extensions', '--disable-gpu', '--disable-workspace-trust', `--user-data-dir=${path.join(fixture, 'profile')}`, `--extensions-dir=${path.join(fixture, 'extensions')}`],
        extensionTestsEnv: { LOCALFORGE_CHAT_FIXTURE: fixture, LOCALFORGE_CHAT_PHASE: phase }
      });
      console.log(`[ChatRestart] ${phase} process passed`);
    }
    console.log(process.argv.includes('--live-edit') ? '[ChatRestart] REAL OLLAMA REVIEW-ONLY CREATION, EXACT CONTENT AND APPROVED SAVE PASSED' : process.argv.includes('--live-memory') ? '[ChatRestart] REAL OLLAMA OLDER-CHAT MEMORY EVIDENCE PASSED' : process.argv.includes('--chat-memory') ? '[ChatRestart] TWO-PROCESS CHAT MEMORY, OPT-IN, DELETE AND CLEAR PASSED' : phases.length === 1 ? '[ChatRestart] REAL OLLAMA GREETING WITHOUT PROJECT CONTAMINATION PASSED' : '[ChatRestart] THREE-PROCESS CHAT CRUD, MODEL SWITCHING, CLEAR AND EXACT PERSISTENCE PASSED');
  } finally {
    const absolute = path.resolve(fixture);
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()));
    assert.ok(path.basename(absolute).startsWith('localforge-chat-restart-'));
    try { fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.warn(`[ChatRestart] Temporary test profile retained: ${absolute}: ${error.message}`); }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
