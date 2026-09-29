const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const suite = path.resolve(__dirname, 'suite', 'index.js');
  const workspace = path.resolve(root, 'tests', 'fixtures', 'extension-host');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    launchArgs: [workspace, '--disable-extensions']
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
