const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseReleaseInputs, findWindowsCodeInstallation } = require('../scripts/release.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('release locates versioned VS Code CLI paths without accepting a path outside the installation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lomvren-code-location-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    fs.mkdirSync(path.join(root, '012abc/resources/app/out'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Code.exe'), 'fixture');
    fs.writeFileSync(path.join(root, '012abc/resources/app/out/cli.js'), 'fixture');
    const command = path.join(root, 'bin/code.cmd');
    fs.writeFileSync(command, '"%~dp0..\\Code.exe" "%~dp0..\\012abc\\resources\\app\\out\\cli.js" %*');
    assert.deepEqual(findWindowsCodeInstallation([root]), { binary: path.join(root, 'Code.exe'), cli: path.join(root, '012abc/resources/app/out/cli.js') });
    fs.writeFileSync(command, '"%~dp0..\\Code.exe" "%~dp0..\\..\\outside\\resources\\app\\out\\cli.js" %*');
    assert.throws(() => findWindowsCodeInstallation([root]), /not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('release accepts exact versions/optional actions and rejects ambiguous or command-like input', () => {
  assert.deepEqual(parseReleaseInputs(['--version', '0.3.3', '--install']), { version: '0.3.3', install: true, publish: false });
  assert.equal(parseReleaseInputs(['--version', '1.0.0', '--publish']).publish, true);
  for (const args of [['--version', '1.0'], ['--version', '../1.0.0'], ['--version', '1.0.0 && whoami'], ['--version'], ['--bad'], ['--version', '0.3.3', '--version', '0.3.4'], ['--output', '../outside.vsix'], ['--output', 'x.vsix & whoami']]) assert.throws(() => parseReleaseInputs(args));
});
