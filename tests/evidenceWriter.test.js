const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEvidenceWriter } = require('./extensionHost/evidenceWriter');

test('concurrent benchmark snapshots stay valid and a failed rename preserves previous evidence and permits recovery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lomvren-evidence-'));
  const filename = path.join(directory, 'result.json');
  let fail = false;
  const write = createEvidenceWriter(filename, { ...fs, rename: async (...args) => { if (fail) throw new Error('Controlled rename failure'); return fs.rename(...args); } });
  try {
    await Promise.all(Array.from({ length: 25 }, (_, index) => write({ index })));
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { index: 24 });
    fail = true;
    await assert.rejects(write({ index: 25 }), /rename failure/);
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { index: 24 });
    fail = false;
    await write({ index: 26 });
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { index: 26 });
    assert.deepEqual(await fs.readdir(directory), ['result.json']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
