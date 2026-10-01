const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'extensionHost', 'suite.js');
    const vscodeExecutablePath = process.env.LOCALFORGE_VSCODE_EXECUTABLE
      ? path.resolve(process.env.LOCALFORGE_VSCODE_EXECUTABLE)
      : undefined;
    const launchArgs = [
      '--disable-extensions',
      '--disable-gpu',
      '--no-sandbox'
    ];
    if (process.env.LOCALFORGE_REAL_OLLAMA_EDIT === '1') {
      launchArgs.push(extensionDevelopmentPath);
    }

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
    process.exit(1);
  }
}

main();
