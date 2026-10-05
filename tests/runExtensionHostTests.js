const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-extension-host-'));
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'extensionHost', 'suite.js');
    const vscodeExecutablePath = process.env.LOCALFORGE_VSCODE_EXECUTABLE
      ? path.resolve(process.env.LOCALFORGE_VSCODE_EXECUTABLE)
      : undefined;
    const fixtureWorkspace = path.join(fixtureRoot, 'workspace');
    fs.mkdirSync(fixtureWorkspace);
    for (const filename of ['package.json', 'README.md']) {
      fs.copyFileSync(path.join(extensionDevelopmentPath, filename), path.join(fixtureWorkspace, filename));
    }
    const launchArgs = [
      fixtureWorkspace,
      '--disable-extensions',
      '--disable-gpu',
      '--disable-workspace-trust',
      '--new-window',
      `--user-data-dir=${path.join(fixtureRoot, 'profile')}`,
      `--extensions-dir=${path.join(fixtureRoot, 'extensions')}`
    ];

    console.log('[LocalForge] Launching VS Code Extension Host...');
    console.log('[LocalForge] Extension development path:', extensionDevelopmentPath);
    console.log('[LocalForge] Extension tests path:', extensionTestsPath);
    if (vscodeExecutablePath) {
      console.log('[LocalForge] VS Code executable:', vscodeExecutablePath);
    }

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs
    });

    console.log('[LocalForge] Extension Host tests finished successfully.');
  } catch (err) {
    console.error('[LocalForge] Failed to run extension host tests:', err);
    process.exitCode = 1;
  } finally {
    const fixtureAbsolute = path.resolve(fixtureRoot);
    const temporaryRoot = path.resolve(os.tmpdir());
    assert.equal(path.dirname(fixtureAbsolute), temporaryRoot);
    assert.ok(path.basename(fixtureAbsolute).startsWith('localforge-extension-host-'));
    try {
      fs.rmSync(fixtureAbsolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      console.warn(`[LocalForge] Temporary test profile retained at ${fixtureAbsolute}: ${error.message}`);
    }
  }
}

main();
