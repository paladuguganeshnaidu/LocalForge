const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { EditJournal, EDIT_JOURNAL_KEY, replaceJournalFile } = require('../dist/editing/editJournal.js');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const input = (summary = 'Recorded edit') => ({
  proposalId: 'fixture', root: 'file:///workspace', summary,
  files: [{ path: 'file.txt', originalState: 'present', originalBytes: Buffer.from('original').toString('base64'), originalHash: hash('original'), expectedHash: hash('changed'), reverted: false }]
});

test('recovery journal serializes concurrent writes and does not expose source backups in metadata', async () => {
  let saved;
  let running = 0;
  let simultaneous = 0;
  const storage = { get: () => saved, update: async (_key, value) => {
    running += 1; simultaneous = Math.max(simultaneous, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    saved = structuredClone(value); running -= 1;
  } };
  const journal = new EditJournal(storage);
  const records = await Promise.all(Array.from({ length: 12 }, (_value, index) => journal.prepare(input(`Edit ${index}`))));
  assert.equal(simultaneous, 1);
  assert.equal(new EditJournal(storage).list().length, 12);
  assert.equal(new Set(records.map((record) => record.id)).size, 12);
  assert.equal(JSON.stringify(journal.list()).includes(Buffer.from('original').toString('base64')), false);
  const copy = journal.get(records[0].id);
  copy.files[0].originalBytes = 'mutated';
  assert.notEqual(journal.get(records[0].id).files[0].originalBytes, 'mutated');
});

test('failed journal writes are not committed in memory and do not poison later persistence', async () => {
  let fail = true;
  const storage = { get: () => undefined, update: async () => { if (fail) throw new Error('disk unavailable'); } };
  const journal = new EditJournal(storage);
  await assert.rejects(journal.prepare(input()), /disk unavailable/);
  assert.equal(journal.list().length, 0);
  fail = false;
  assert.ok((await journal.prepare(input())).id);
  assert.equal(journal.list().length, 1);
});

test('bounded journal refuses to silently discard recoverable records and prunes only restored ones', async () => {
  const journal = new EditJournal();
  const records = [];
  for (let index = 0; index < 40; index += 1) records.push(await journal.prepare(input(`Edit ${index}`)));
  await assert.rejects(journal.prepare(input()), /storage is full/);
  assert.equal(journal.list().length, 40);
  await journal.update(records[0].id, 'reverted', [{ path: 'file.txt', reverted: true }]);
  await journal.prepare(input('New edit'));
  assert.equal(journal.list().length, 40);
  assert.equal(journal.get(records[0].id), undefined);
});

test('malformed hashes, duplicate paths and traversal cannot become recovery records', async () => {
  const journal = new EditJournal();
  for (const invalid of ['../outside.txt', 'C:/outside.txt', 'sub/NUL', 'safe.txt:stream']) {
    const record = input(); record.files[0].path = invalid;
    await assert.rejects(journal.prepare(record), /invalid/);
  }
  const duplicate = input(); duplicate.files.push(structuredClone(duplicate.files[0]));
  await assert.rejects(journal.prepare(duplicate), /invalid/);
  const corrupted = input(); corrupted.files[0].originalHash = hash('wrong baseline');
  await assert.rejects(journal.prepare(corrupted), /invalid/);
  assert.equal(journal.list().length, 0);
  const ignored = new EditJournal({ get: (key) => key === EDIT_JOURNAL_KEY ? { version: 99, records: [] } : undefined });
  assert.equal(ignored.list().length, 0);
});

test('durable snapshots survive a fresh process without relying on deferred workspace-state writes', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-journal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storage = { get: () => undefined, update: async () => { throw new Error('Deferred storage must not be used'); } };
  const journal = new EditJournal(storage, directory);
  const record = await journal.prepare(input());
  await journal.update(record.id, 'applied');
  const output = execFileSync(process.execPath, ['-e',
    `const {EditJournal}=require(${JSON.stringify(require.resolve('../dist/editing/editJournal.js'))}); process.stdout.write(JSON.stringify(new EditJournal(undefined,process.argv[1]).list()));`, directory], { encoding: 'utf8' });
  assert.equal(JSON.parse(output)[0].id, record.id);
  assert.equal(JSON.parse(output)[0].status, 'applied');
  assert.deepEqual(fs.readdirSync(directory), ['edit-recovery.v1.json']);
  assert.equal(new EditJournal(undefined, directory).get(record.id).files[0].originalBytes, input().files[0].originalBytes);
});

test('corrupt durable storage fails closed and preserves the existing backup file', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-journal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'edit-recovery.v1.json');
  for (const invalid of ['{broken', 'null', JSON.stringify({ version: 1, records: [input()] })]) {
    fs.writeFileSync(target, invalid);
    const journal = new EditJournal(undefined, directory);
    await assert.rejects(journal.prepare(input()), /recovery/i);
    assert.equal(fs.readFileSync(target, 'utf8'), invalid);
    assert.equal(journal.list().length, 0);
  }
});

test('legacy workspace backups migrate on the first durable update', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-journal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let saved;
  const storage = { get: () => saved, update: async (_key, value) => { saved = structuredClone(value); } };
  const legacy = new EditJournal(storage);
  const record = await legacy.prepare(input());
  const migrated = new EditJournal(storage, directory);
  assert.equal(migrated.list()[0].id, record.id);
  await migrated.update(record.id, 'applied');
  assert.equal(new EditJournal(undefined, directory).list()[0].status, 'applied');
});

test('move recovery records validate both endpoints and reject malformed linked entries without crashing', async () => {
  const journal = new EditJournal();
  const moved = input();
  moved.files[0].expectedHash = '';
  moved.files[0].linkedPath = 'destination.txt';
  moved.files.push({ path: 'destination.txt', originalState: 'missing', originalBytes: '', originalHash: '', expectedHash: hash('original'), reverted: false, linkedPath: 'file.txt' });
  assert.ok((await journal.prepare(moved)).id);
  for (const invalid of [
    { ...moved, files: [moved.files[0], null] },
    { ...moved, files: [moved.files[0], { ...moved.files[1], expectedHash: hash('different bytes') }] },
    { ...moved, files: [{ ...moved.files[0], expectedHash: [hash('original')] }, moved.files[1]] }
  ]) await assert.rejects(journal.prepare(invalid), /invalid/);
});

test('atomic backup replacement retries transient locks without removing the previous backup', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-journal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'new.tmp');
  const destination = path.join(directory, 'previous.json');
  fs.writeFileSync(source, 'new backup');
  fs.writeFileSync(destination, 'previous backup');
  let attempts = 0;
  await replaceJournalFile(source, destination, async (temporary, target) => {
    attempts += 1;
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous backup');
    if (attempts <= 2) throw Object.assign(new Error('transient file lock'), { code: 'EPERM' });
    await fs.promises.rename(temporary, target);
  });
  assert.equal(attempts, 3);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new backup');
});

test('persistent replacement failures preserve both backups and terminate after bounded retries', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localforge-journal-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'new.tmp');
  const destination = path.join(directory, 'previous.json');
  fs.writeFileSync(source, 'new backup');
  fs.writeFileSync(destination, 'previous backup');
  let attempts = 0;
  await assert.rejects(replaceJournalFile(source, destination, async () => {
    attempts += 1;
    throw Object.assign(new Error('still locked'), { code: 'EBUSY' });
  }), /still locked/);
  assert.equal(attempts, 7);
  assert.equal(fs.readFileSync(source, 'utf8'), 'new backup');
  assert.equal(fs.readFileSync(destination, 'utf8'), 'previous backup');
  attempts = 0;
  await assert.rejects(replaceJournalFile(source, destination, async () => {
    attempts += 1;
    throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
  }), /no space/);
  assert.equal(attempts, 1);
});
