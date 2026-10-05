const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyCurrentBuildPayload } = require('../scripts/verify-marketplace-package.cjs');

test('package verification rejects stale runtime/icon bytes, duplicate entries and stale contributions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-payload-'));
  try {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.mkdirSync(path.join(root, 'media'));
    const runtime = Buffer.from('CURRENT_RUNTIME');
    const icon = Buffer.from([0, 255, 128, 42]);
    fs.writeFileSync(path.join(root, 'dist', 'extension.bundle.js'), runtime);
    fs.writeFileSync(path.join(root, 'media', 'icon.png'), icon);
    const manifest = { main: './dist/extension.bundle.js', icon: 'media/icon.png', contributes: { commands: [{ command: 'localforge.openAgent' }] } };
    const entries = new Map([['extension/dist/extension.bundle.js', runtime], ['extension/media/icon.png', icon]]);
    const verify = (packagedManifest = manifest, listing = [...entries.keys()]) => verifyCurrentBuildPayload(manifest, packagedManifest, listing, root, (entry) => entries.get(entry));
    assert.doesNotThrow(() => verify());
    entries.set('extension/dist/extension.bundle.js', Buffer.from('OLD_RUNTIME'));
    assert.throws(() => verify(), /does not match the current build/);
    entries.set('extension/dist/extension.bundle.js', runtime);
    entries.set('extension/media/icon.png', Buffer.from('OLD_ICON'));
    assert.throws(() => verify(), /does not match the current build/);
    entries.set('extension/media/icon.png', icon);
    assert.throws(() => verify(manifest, [...entries.keys(), 'extension/dist/extension.bundle.js']), /Duplicate or missing/);
    assert.throws(() => verify({ ...manifest, contributes: { commands: [] } }), /contributions differ/);
    assert.throws(() => verify(manifest, ['extension/media/icon.png']), /Duplicate or missing/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
