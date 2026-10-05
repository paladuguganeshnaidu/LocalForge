const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { planPackage } = require('../scripts/package-extension.cjs');

test('normal packaging refuses to replace an existing checkpoint and accepts a new exact development artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lomvren-package-guard-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'localforge-vscode', version: '0.3.0' }));
    const checkpoint = planPackage(root);
    fs.writeFileSync(checkpoint, 'PRESERVED_RUNTIME');
    assert.throws(() => planPackage(root), /Refusing to overwrite/);
    assert.equal(fs.readFileSync(checkpoint, 'utf8'), 'PRESERVED_RUNTIME');
    assert.equal(planPackage(root, 'new-runtime.vsix'), path.join(root, 'new-runtime.vsix'));
    assert.throws(() => planPackage(root, '../other-project.vsix'), /inside the project/);
    assert.throws(() => planPackage(root, 'README.md'), /\.vsix output/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
