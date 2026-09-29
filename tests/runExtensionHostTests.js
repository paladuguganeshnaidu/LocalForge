const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'extensionHost', 'suite.js');

    console.log('[LocalForge] Launching VS Code Extension Host...');
    console.log('[LocalForge] Extension development path:', extensionDevelopmentPath);
    console.log('[LocalForge] Extension tests path:', extensionTestsPath);

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox'
      ]
    });

    console.log('[LocalForge] Extension Host tests finished successfully.');
  } catch (err) {
    console.error('[LocalForge] Failed to run extension host tests:', err);
    process.exit(1);
  }
}

main();
