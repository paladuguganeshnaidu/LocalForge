const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-recovery-restart-'));
  const workspace = path.join(fixture, 'project');
  fs.mkdirSync(workspace);
  try {
    for (const phase of ['prepare', 'restore']) {
      await runTests({
        vscodeExecutablePath: process.env.LOCALFORGE_VSCODE_EXECUTABLE || undefined,
        extensionDevelopmentPath: path.resolve(__dirname, '..'),
        extensionTestsPath: path.resolve(__dirname, 'extensionHost', 'recoveryRestartSuite.js'),
        launchArgs: [workspace, '--disable-extensions', '--disable-gpu', '--disable-workspace-trust',
          `--user-data-dir=${path.join(fixture, 'profile')}`, `--extensions-dir=${path.join(fixture, 'extensions')}`],
        extensionTestsEnv: { LOCALFORGE_RECOVERY_FIXTURE: fixture, LOCALFORGE_RECOVERY_PHASE: phase }
      });
      console.log(`[RecoveryRestart] ${phase} process exited successfully`);
    }
    console.log('[RecoveryRestart] REAL VS CODE RESTART AND EXACT ROLLBACK PASSED');
  } finally {
    const absolute = path.resolve(fixture);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
    try {
      fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (!['EPERM', 'EBUSY'].includes(error.code) || fs.readdirSync(absolute).length) throw error;
      console.warn(`[RecoveryRestart] Windows retained an empty fixture directory: ${absolute}`);
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
