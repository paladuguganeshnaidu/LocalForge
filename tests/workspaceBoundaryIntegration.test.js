const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');

let declineEdits = false;
let writes = 0;
let statHook;
class FileSystemError extends Error {}
class WorkspaceEdit {
  constructor() { this.operations = []; }
  createFile(uri, options) { this.operations.push({ uri, create: true, overwrite: options.overwrite, content: options.contents }); }
  deleteFile(uri) { this.operations.push({ uri, remove: true }); }
  insert(uri, _position, content) { this.operations.push({ uri, content }); }
  replace(uri, _range, content) { this.operations.push({ uri, content }); }
}
const uri = (filePath) => ({ fsPath: filePath, path: filePath, scheme: 'file', toString: () => pathToFileURL(filePath).href });
const vscode = {
  FileSystemError, WorkspaceEdit,
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class {},
  Uri: { joinPath: (root, ...segments) => uri(path.join(root.fsPath, ...segments)) },
  workspace: {
    isTrusted: true, workspaceFolders: [],
    getWorkspaceFolder: (target) => vscode.workspace.workspaceFolders.find((folder) => {
      const relative = path.relative(folder.uri.fsPath, target.fsPath);
      return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    }),
    asRelativePath: (target) => path.relative(vscode.workspace.getWorkspaceFolder(target).uri.fsPath, target.fsPath).replace(/\\/g, '/'),
    textDocuments: [],
    openTextDocument: async () => ({ isDirty: false }),
    fs: {
      readFile: (target) => fs.readFile(target.fsPath),
      writeFile: async (target, content) => { writes += 1; await fs.writeFile(target.fsPath, content); },
      stat: (target) => statHook ? statHook(target) : fs.stat(target.fsPath)
    },
    applyEdit: async (edit) => {
      if (declineEdits) return false;
      for (const operation of edit.operations) {
        if (operation.remove) await fs.unlink(operation.uri.fsPath);
        else if (operation.create) await fs.writeFile(operation.uri.fsPath, operation.content, { flag: operation.overwrite ? 'w' : 'wx' });
        else await fs.writeFile(operation.uri.fsPath, operation.content);
      }
      return true;
    }
  }
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return originalLoad.apply(this, arguments);
};
const { EditEngine } = require('../dist/editing/editEngine.js');
const { registerAllCoreTools } = require('../dist/agent/coreTools.js');
const { executeWorkspaceTool } = require('../dist/agent/workspaceTools.js');
const { applyReviewedSelection } = require('../dist/editing/selectionEdits.js');
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { assertWorkspaceFilePath, validateWorkspaceRelativePath } = require('../dist/core/workspacePaths.js');
const { EditJournal, EDIT_JOURNAL_KEY } = require('../dist/editing/editJournal.js');
const { computeContentHash } = require('../dist/editing/patchService.js');

function storageFixture() {
  const data = new Map();
  return {
    data,
    get: (key) => structuredClone(data.get(key)),
    update: async (key, value) => { data.set(key, structuredClone(value)); }
  };
}

async function fixture(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-boundary-'));
  const root = path.join(directory, 'workspace');
  const external = path.join(directory, 'external');
  await fs.mkdir(root);
  await fs.mkdir(external);
  vscode.workspace.workspaceFolders = [{ name: 'workspace', uri: uri(root) }];
  declineEdits = false;
  statHook = undefined;
  writes = 0;
  vscode.workspace.textDocuments = [];
  try { await run({ root, external }); }
  finally {
    statHook = undefined;
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('workspace paths reject traversal, alternate streams, invalid names and protocol escapes', () => {
  for (const unsafe of ['../outside', '/absolute', 'C:/outside', '//host/share', 'file:target', 'safe.txt:secret', 'sub/NUL.txt', 'sub/trailing.', 'sub/bad\0name']) {
    assert.throws(() => validateWorkspaceRelativePath(unsafe), /normalized relative path/);
  }
  assert.deepEqual(validateWorkspaceRelativePath('src/code.ts'), ['src', 'code.ts']);
});

test('new files beneath an external junction are refused by both workspace tool runtimes', async () => fixture(async ({ root, external }) => {
  await fs.symlink(external, path.join(root, 'linked'), 'junction');
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, {});
  await assert.rejects(registry.executeTool('create_file', { path: 'linked/escape.txt', content: 'unsafe' }), /outside the workspace/);
  await assert.rejects(executeWorkspaceTool('write_workspace_file', { path: 'linked/escape.txt', content: 'unsafe' }), /outside the workspace/);
  await assert.rejects(fs.stat(path.join(external, 'escape.txt')), { code: 'ENOENT' });
}));

test('normal missing parents and an internal junction remain valid', async () => fixture(async ({ root }) => {
  await assertWorkspaceFilePath(root, path.join(root, 'new', 'nested', 'file.txt'), true);
  await fs.mkdir(path.join(root, 'actual'));
  await fs.symlink(path.join(root, 'actual'), path.join(root, 'linked'), 'junction');
  await assertWorkspaceFilePath(root, path.join(root, 'linked', 'new.txt'), true);
}));

test('dangling external directory links cannot disguise a missing file as local', async () => fixture(async ({ root, external }) => {
  await fs.symlink(path.join(external, 'future'), path.join(root, 'dangling'), 'junction');
  await assert.rejects(assertWorkspaceFilePath(root, path.join(root, 'dangling', 'new.txt'), true), /outside the workspace/);
}));

test('edit proposals cannot bypass path restrictions through the review path', async () => fixture(async ({ root, external }) => {
  const engine = new EditEngine();
  await fs.symlink(external, path.join(root, 'linked'), 'junction');
  await assert.rejects(engine.proposeEdits(uri(root), [{ path: 'linked/new.txt', newContent: 'unsafe' }]), /outside the workspace/);
  await assert.rejects(engine.proposeEdits(uri(root), [{ path: '../external/new.txt', newContent: 'unsafe' }]), /normalized relative path/);
  assert.equal(engine.getPendingProposals().length, 0);
}));

test('accept rechecks links changed after a proposal was created', async () => fixture(async ({ root, external }) => {
  await fs.mkdir(path.join(root, 'new'));
  const engine = new EditEngine();
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'new/file.txt', newContent: 'safe' }]);
  await fs.rmdir(path.join(root, 'new'));
  await fs.symlink(external, path.join(root, 'new'), 'junction');
  await assert.rejects(engine.applyProposal(proposal.id), /outside the workspace/);
  await assert.rejects(fs.stat(path.join(external, 'file.txt')), { code: 'ENOENT' });
}));

test('cancelling during a deferred existence check prevents the actual core file write', async () => fixture(async () => {
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const checking = new Promise((resolve) => { started = resolve; });
  statHook = async () => { started(); await gate; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, {});
  const controller = new AbortController();
  const outcome = registry.executeTool('create_file', { path: 'cancelled.txt', content: 'unsafe' }, undefined, { signal: controller.signal });
  await checking;
  controller.abort();
  await assert.rejects(outcome, { name: 'AbortError' });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
}));

test('VS Code refusing an edit is never overridden by direct file writes', async () => fixture(async ({ root }) => {
  const engine = new EditEngine();
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'declined.txt', newContent: 'unsafe' }]);
  declineEdits = true;
  const result = await engine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.match(result.errors[0].error, /declined the edit transaction/);
  assert.equal(writes, 0);
  await assert.rejects(fs.stat(path.join(root, 'declined.txt')), { code: 'ENOENT' });
}));

test('individual file acceptance preserves the remaining pending review', async () => fixture(async ({ root }) => {
  const engine = new EditEngine();
  const proposal = await engine.proposeEdits(uri(root), [
    { path: 'first.txt', newContent: 'first' }, { path: 'second.txt', newContent: 'second' }
  ]);
  assert.equal((await engine.applyProposal(proposal.id, ['first.txt'])).success, true);
  assert.equal(proposal.status, 'pending');
  assert.equal((await engine.applyProposal(proposal.id, ['second.txt'])).success, true);
  assert.equal(proposal.status, 'applied');
  assert.equal(await fs.readFile(path.join(root, 'second.txt'), 'utf8'), 'second');
  await assert.rejects(engine.applyProposal(proposal.id), /cannot be applied/);
}));

test('empty and duplicate-path proposals are refused without storing review state', async () => fixture(async ({ root }) => {
  const engine = new EditEngine();
  await assert.rejects(engine.proposeEdits(uri(root), []), /at least one file/);
  await assert.rejects(engine.proposeEdits(uri(root), [
    { path: 'same.txt', newContent: 'one' }, { path: 'same.txt', newContent: 'two' }
  ]), /duplicate file paths/);
  assert.equal(engine.getPendingProposals().length, 0);
}));

test('rejected proposals cannot be revived by a stale accept action', async () => fixture(async ({ root }) => {
  const engine = new EditEngine();
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'rejected.txt', newContent: 'unsafe' }]);
  engine.rejectProposal(proposal.id);
  await assert.rejects(engine.applyProposal(proposal.id), /rejected and cannot be applied/);
  await assert.rejects(fs.stat(path.join(root, 'rejected.txt')), { code: 'ENOENT' });
}));

test('unsaved user buffers are protected both at proposal time and at acceptance', async () => fixture(async ({ root }) => {
  const engine = new EditEngine();
  const target = uri(path.join(root, 'dirty.txt'));
  await fs.writeFile(target.fsPath, 'original');
  vscode.workspace.textDocuments = [{ uri: target, isDirty: true }];
  await assert.rejects(engine.proposeEdits(uri(root), [{ path: 'dirty.txt', newContent: 'unsafe' }]), /unsaved changes/);
  vscode.workspace.textDocuments = [];
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'dirty.txt', newContent: 'unsafe' }]);
  vscode.workspace.textDocuments = [{ uri: target, isDirty: true }];
  await assert.rejects(engine.applyProposal(proposal.id), /unsaved changes/);
  assert.equal(await fs.readFile(target.fsPath, 'utf8'), 'original');
}));

test('recorded multi-file rollback survives engine recreation and restores exact original bytes', async () => fixture(async ({ root }) => {
  const storage = storageFixture();
  const original = Buffer.from('\ufefforiginal\r\nwith Windows line endings\r\n');
  await fs.writeFile(path.join(root, 'existing.txt'), original);
  const engine = new EditEngine(storage);
  const proposal = await engine.proposeEdits(uri(root), [
    { path: 'existing.txt', newContent: 'replacement' }, { path: 'new.txt', newContent: 'created' }
  ]);
  const applied = await engine.applyProposal(proposal.id);
  assert.equal(applied.success, true);
  assert.ok(applied.recoveryId);
  const restoredEngine = new EditEngine(storage);
  assert.equal(restoredEngine.getRecoveryHistory().length, 1);
  const result = await restoredEngine.rollbackChanges(applied.recoveryId);
  assert.equal(result.success, true);
  assert.equal(result.restoredFiles.length, 2);
  assert.deepEqual(await fs.readFile(path.join(root, 'existing.txt')), original);
  await assert.rejects(fs.stat(path.join(root, 'new.txt')), { code: 'ENOENT' });
  assert.equal(new EditEngine(storage).getRecoveryHistory()[0].status, 'reverted');
}));

test('one manual edit blocks an entire multi-file rollback without overwriting either file', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'first.txt'), 'first original');
  const engine = new EditEngine(storageFixture());
  const proposal = await engine.proposeEdits(uri(root), [
    { path: 'first.txt', newContent: 'first changed' }, { path: 'second.txt', newContent: 'second changed' }
  ]);
  const applied = await engine.applyProposal(proposal.id);
  await fs.writeFile(path.join(root, 'first.txt'), 'user changed this');
  const result = await engine.rollbackChanges(applied.recoveryId);
  assert.equal(result.success, false);
  assert.equal(result.restoredFiles.length, 0);
  assert.match(result.conflicts[0].error, /changed after/);
  assert.equal(await fs.readFile(path.join(root, 'first.txt'), 'utf8'), 'user changed this');
  assert.equal(await fs.readFile(path.join(root, 'second.txt'), 'utf8'), 'second changed');
}));

test('rollback refuses unsaved buffers, external junction replacements and foreign workspaces', async () => fixture(async ({ root, external }) => {
  await fs.mkdir(path.join(root, 'folder'));
  const engine = new EditEngine(storageFixture());
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'folder/new.txt', newContent: 'created' }]);
  const applied = await engine.applyProposal(proposal.id);
  vscode.workspace.textDocuments = [{ uri: uri(path.join(root, 'folder/new.txt')), isDirty: true }];
  assert.equal((await engine.rollbackChanges(applied.recoveryId)).success, false);
  vscode.workspace.textDocuments = [];
  await fs.unlink(path.join(root, 'folder/new.txt'));
  await fs.rmdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(external, 'new.txt'), 'created');
  await fs.symlink(external, path.join(root, 'folder'), 'junction');
  const result = await engine.rollbackChanges(applied.recoveryId);
  assert.equal(result.success, false);
  assert.match(result.conflicts[0].error, /outside the workspace/);
  assert.equal(await fs.readFile(path.join(external, 'new.txt'), 'utf8'), 'created');
  vscode.workspace.workspaceFolders = [{ uri: uri(external) }];
  await assert.rejects(engine.rollbackChanges(applied.recoveryId), /original workspace/);
}));

test('selected-file rollback preserves remaining history and respects native refusal', async () => fixture(async ({ root }) => {
  const engine = new EditEngine(storageFixture());
  const proposal = await engine.proposeEdits(uri(root), [
    { path: 'first.txt', newContent: 'first' }, { path: 'second.txt', newContent: 'second' }
  ]);
  const applied = await engine.applyProposal(proposal.id);
  declineEdits = true;
  assert.equal((await engine.rollbackChanges(applied.recoveryId)).success, false);
  assert.equal(writes, 0);
  declineEdits = false;
  assert.equal((await engine.rollbackChanges(applied.recoveryId, ['first.txt'])).success, true);
  assert.equal(engine.getRecoveryHistory()[0].status, 'partially_reverted');
  assert.deepEqual(engine.getRecoveryHistory()[0].remainingFiles, ['second.txt']);
  assert.equal((await engine.rollbackChanges(applied.recoveryId)).success, true);
  assert.equal(engine.getRecoveryHistory()[0].status, 'reverted');
}));

test('overlapping recorded edits must be rolled back newest-first', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'same.txt'), 'original');
  const engine = new EditEngine(storageFixture());
  const first = await engine.proposeEdits(uri(root), [{ path: 'same.txt', newContent: 'first' }]);
  const appliedFirst = await engine.applyProposal(first.id);
  const second = await engine.proposeEdits(uri(root), [{ path: 'same.txt', newContent: 'second' }]);
  const appliedSecond = await engine.applyProposal(second.id);
  assert.equal((await engine.rollbackChanges(appliedFirst.recoveryId)).success, false);
  assert.equal((await engine.rollbackChanges(appliedSecond.recoveryId)).success, true);
  assert.equal((await engine.rollbackChanges(appliedFirst.recoveryId)).success, true);
  assert.equal(await fs.readFile(path.join(root, 'same.txt'), 'utf8'), 'original');
}));

test('a prepared crash-recovery record restores only edits that actually reached disk', async () => fixture(async ({ root }) => {
  const storage = storageFixture();
  const journal = new EditJournal(storage);
  await fs.writeFile(path.join(root, 'existing.txt'), 'original');
  const record = await journal.prepare({
    proposalId: 'interrupted-proposal', root: uri(root).toString(), summary: 'Interrupted write',
    files: [
      { path: 'existing.txt', originalState: 'present', originalBytes: Buffer.from('original').toString('base64'), originalHash: computeContentHash('original'), expectedHash: computeContentHash('changed'), reverted: false },
      { path: 'not-created.txt', originalState: 'missing', originalBytes: '', originalHash: '', expectedHash: computeContentHash('created'), reverted: false }
    ]
  });
  await fs.writeFile(path.join(root, 'existing.txt'), 'changed');
  const engine = new EditEngine(storage);
  const result = await engine.rollbackChanges(record.id);
  assert.equal(result.success, true);
  assert.deepEqual(result.restoredFiles, ['existing.txt']);
  assert.deepEqual(result.unchangedFiles, ['not-created.txt']);
  assert.equal(await fs.readFile(path.join(root, 'existing.txt'), 'utf8'), 'original');
}));

test('recovery persistence failure refuses editing before submitting any native mutation', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'existing.txt'), 'original');
  const engine = new EditEngine({ get: () => undefined, update: async () => { throw new Error('storage unavailable'); } });
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'existing.txt', newContent: 'unsafe' }]);
  const result = await engine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.match(result.errors[0].error, /storage unavailable/);
  assert.equal(await fs.readFile(path.join(root, 'existing.txt'), 'utf8'), 'original');
  assert.equal(engine.getRecoveryHistory().length, 0);
}));

test('changes made while the recovery snapshot is persisted cannot be overwritten by acceptance', async () => fixture(async ({ root }) => {
  const target = path.join(root, 'existing.txt');
  await fs.writeFile(target, 'original');
  const storage = storageFixture();
  const update = storage.update;
  storage.update = async (key, value) => {
    await update(key, value);
    await fs.writeFile(target, 'manual edit during snapshot persistence');
  };
  const engine = new EditEngine(storage);
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'existing.txt', newContent: 'generated' }]);
  const result = await engine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.equal(result.appliedCount, 0);
  assert.match(result.errors.at(-1).error, /changed while.*snapshot/);
  assert.equal(await fs.readFile(target, 'utf8'), 'manual edit during snapshot persistence');
}));

test('corrupt persisted original content is rejected and cancelled rollback does not mutate files', async () => fixture(async ({ root }) => {
  const storage = storageFixture();
  const engine = new EditEngine(storage);
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'new.txt', newContent: 'created' }]);
  const applied = await engine.applyProposal(proposal.id);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(engine.rollbackChanges(applied.recoveryId, undefined, controller.signal), { name: 'AbortError' });
  assert.equal(await fs.readFile(path.join(root, 'new.txt'), 'utf8'), 'created');
  const payload = storage.get(EDIT_JOURNAL_KEY);
  payload.records[0].files[0].originalBytes = Buffer.from('corrupt baseline').toString('base64');
  storage.data.set(EDIT_JOURNAL_KEY, payload);
  assert.equal(new EditEngine(storage).getRecoveryHistory().length, 0);
}));

test('selection edits share recorded recovery and preserve unselected text', async () => fixture(async ({ root }) => {
  const target = path.join(root, 'selection.txt');
  await fs.writeFile(target, 'prefix ORIGINAL suffix');
  const engine = new EditEngine(storageFixture());
  const document = { uri: uri(target), isDirty: false, isClosed: false, version: 1, getText: () => 'prefix ORIGINAL suffix', offsetAt: (position) => position.character };
  const result = await applyReviewedSelection(engine, document, { start: { character: 7 }, end: { character: 15 } }, 'CHANGED');
  assert.equal(result.success, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'prefix CHANGED suffix');
  assert.equal((await engine.rollbackChanges(result.recoveryId)).success, true);
  assert.equal(await fs.readFile(target, 'utf8'), 'prefix ORIGINAL suffix');
}));
