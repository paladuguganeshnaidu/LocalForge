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
  renameFile(uri, destination) { this.operations.push({ uri, destination, rename: true }); }
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
        if (operation.rename) await fs.rename(operation.uri.fsPath, operation.destination.fsPath);
        else if (operation.remove) await fs.unlink(operation.uri.fsPath);
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
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { registerAllCoreTools } = require('../dist/agent/coreTools.js');
const { executeWorkspaceTool } = require('../dist/agent/workspaceTools.js');
const { applyReviewedSelection } = require('../dist/editing/selectionEdits.js');
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { TerminalManager } = require('../dist/terminal/terminalManager.js');
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

test('cancelling during a deferred existence check prevents the actual core file write', async () => fixture(async ({ root }) => {
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const checking = new Promise((resolve) => { started = resolve; });
  statHook = async () => { started(); await gate; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine: new EditEngine(), autoApply: true });
  const controller = new AbortController();
  const outcome = registry.executeTool('create_file', { path: 'cancelled.txt', content: 'unsafe' }, undefined, { signal: controller.signal });
  await checking;
  controller.abort();
  await assert.rejects(outcome, { name: 'AbortError' });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  await assert.rejects(fs.stat(path.join(root, 'cancelled.txt')), { code: 'ENOENT' });
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

test('create_file prepares a reviewable creation, refuses an existing target, and supports Undo', async () => fixture(async ({ root }) => {
  const engine = new EditEngine(storageFixture());
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine: engine });
  const result = await registry.executeTool('create_file', { path: 'new.txt', content: '' });
  assert.equal(result.proposed, true);
  await assert.rejects(fs.stat(path.join(root, 'new.txt')), { code: 'ENOENT' });
  assert.equal(engine.getProposal(result.proposalId).files[0].operation, 'create');
  const applied = await engine.applyProposal(result.proposalId);
  assert.equal(applied.success, true, JSON.stringify(applied.errors));
  assert.equal((await fs.stat(path.join(root, 'new.txt'))).size, 0);
  await assert.rejects(registry.executeTool('create_file', { path: 'new.txt', content: 'overwrite' }), /already exists/);
  assert.equal((await engine.rollbackChanges(applied.recoveryId)).success, true);
  await assert.rejects(fs.stat(path.join(root, 'new.txt')), { code: 'ENOENT' });
}));

test('replace_range uses reviewed editing, preserves CRLF, validates full ranges, and restores exact bytes', async () => fixture(async ({ root }) => {
  const target = path.join(root, 'lines.txt');
  const original = Buffer.from('\ufefffirst\r\nsecond\r\nthird\r\n');
  await fs.writeFile(target, original);
  const engine = new EditEngine(storageFixture());
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine: engine });
  for (const [start_line, end_line] of [[NaN, 2], [1.5, 2], [2, 1], [1, 99]]) {
    await assert.rejects(registry.executeTool('replace_range', { path: 'lines.txt', start_line, end_line, replacement: 'unsafe' }), /Invalid line range/);
  }
  const result = await registry.executeTool('replace_range', { path: 'lines.txt', start_line: 2, end_line: 2, replacement: 'changed' });
  assert.equal(result.proposed, true);
  assert.deepEqual(await fs.readFile(target), original);
  const proposal = engine.getProposal(result.proposalId);
  assert.equal(proposal.files[0].newContent, 'first\r\nchanged\r\nthird\r\n');
  const applied = await engine.applyProposal(proposal.id);
  assert.equal(applied.success, true);
  assert.equal((await engine.rollbackChanges(applied.recoveryId)).success, true);
  assert.deepEqual(await fs.readFile(target), original);
}));

test('deletion requires explicit approval, awaits review, and restores a binary file after engine recreation', async () => fixture(async ({ root }) => {
  const target = path.join(root, 'binary.dat');
  const original = Buffer.from([0, 255, 17, 128, 0, 200]);
  await fs.writeFile(target, original);
  const storage = storageFixture();
  const engine = new EditEngine(storage);
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine: engine });
  const permissions = new PermissionManager('always_proceed', async () => false);
  await assert.rejects(registry.executeTool('delete_file', { path: 'binary.dat' }, permissions), /rejected/);
  assert.equal(engine.getPendingProposals().length, 0);
  permissions.setApprovalHandler(async () => true);
  const result = await registry.executeTool('delete_file', { path: 'binary.dat' }, permissions);
  assert.equal(result.proposed, true);
  assert.deepEqual(await fs.readFile(target), original);
  const applied = await engine.applyProposal(result.proposalId);
  assert.equal(applied.success, true, JSON.stringify(applied.errors));
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  const restored = await new EditEngine(storage).rollbackChanges(applied.recoveryId);
  assert.equal(restored.success, true, JSON.stringify(restored.conflicts));
  assert.deepEqual(await fs.readFile(target), original);
}));

test('file moves require approval and paired review, preserve binary bytes, and Undo both paths together', async () => fixture(async ({ root }) => {
  const original = Buffer.from([0, 254, 0, 128, 73]);
  const source = path.join(root, 'source.dat');
  const destination = path.join(root, 'destination.dat');
  await fs.writeFile(source, original);
  const storage = storageFixture();
  const engine = new EditEngine(storage);
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine: engine });
  const permissions = new PermissionManager('allow_safe_auto', async () => false);
  await assert.rejects(registry.executeTool('move_file', { source_path: 'source.dat', destination_path: 'destination.dat' }, permissions), /rejected/);
  permissions.setApprovalHandler(async () => true);
  const result = await registry.executeTool('move_file', { source_path: 'source.dat', destination_path: 'destination.dat' }, permissions);
  assert.equal(result.proposed, true);
  await assert.rejects(engine.applyProposal(result.proposalId, ['source.dat']), /both.*source.*destination/);
  assert.deepEqual(await fs.readFile(source), original);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
  const applied = await engine.applyProposal(result.proposalId);
  assert.equal(applied.success, true, JSON.stringify(applied.errors));
  await assert.rejects(fs.stat(source), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(destination), original);
  const recreated = new EditEngine(storage);
  await assert.rejects(recreated.rollbackChanges(applied.recoveryId, ['source.dat']), /both.*source.*destination/);
  const restored = await recreated.rollbackChanges(applied.recoveryId);
  assert.equal(restored.success, true, JSON.stringify(restored.conflicts));
  assert.deepEqual(await fs.readFile(source), original);
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
}));

test('moves refuse collisions and changed destination contents without losing either version', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'source.txt'), 'original');
  await fs.writeFile(path.join(root, 'collision.txt'), 'existing destination');
  const engine = new EditEngine(storageFixture());
  await assert.rejects(engine.proposeMove(uri(root), 'source.txt', 'collision.txt'), /already exists/);
  await assert.rejects(engine.proposeMove(uri(root), 'source.txt', 'source.txt'), /duplicate/);
  const proposal = await engine.proposeMove(uri(root), 'source.txt', 'moved.txt');
  const applied = await engine.applyProposal(proposal.id);
  await fs.writeFile(path.join(root, 'moved.txt'), 'later manual edit');
  const rollback = await engine.rollbackChanges(applied.recoveryId);
  assert.equal(rollback.success, false);
  await assert.rejects(fs.stat(path.join(root, 'source.txt')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'moved.txt'), 'utf8'), 'later manual edit');
  assert.equal(await fs.readFile(path.join(root, 'collision.txt'), 'utf8'), 'existing destination');
}));

test('mixed write, creation, and deletion share one reviewed native transaction and recovery record', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'edit.txt'), 'before');
  await fs.writeFile(path.join(root, 'delete.txt'), 'delete original');
  const engine = new EditEngine(storageFixture());
  const proposal = await engine.proposeEdits(uri(root), [
    { path: 'edit.txt', newContent: 'after' },
    { path: 'create.txt', newContent: 'created', operation: 'create' },
    { path: 'delete.txt', newContent: '', operation: 'delete' }
  ]);
  const applied = await engine.applyProposal(proposal.id);
  assert.equal(applied.success, true, JSON.stringify(applied.errors));
  assert.equal(applied.appliedCount, 3);
  await assert.rejects(fs.stat(path.join(root, 'delete.txt')), { code: 'ENOENT' });
  const restored = await engine.rollbackChanges(applied.recoveryId);
  assert.equal(restored.success, true, JSON.stringify(restored.conflicts));
  assert.equal(await fs.readFile(path.join(root, 'edit.txt'), 'utf8'), 'before');
  assert.equal(await fs.readFile(path.join(root, 'delete.txt'), 'utf8'), 'delete original');
  await assert.rejects(fs.stat(path.join(root, 'create.txt')), { code: 'ENOENT' });
}));

test('a file replaced by an internal junction cannot redirect accepted deletion', async () => fixture(async ({ root }) => {
  const target = path.join(root, 'target.txt');
  const other = path.join(root, 'other');
  await fs.writeFile(target, 'same bytes');
  await fs.mkdir(other);
  await fs.writeFile(path.join(other, 'preserved.txt'), 'same bytes');
  const engine = new EditEngine(storageFixture());
  const proposal = await engine.proposeEdits(uri(root), [{ path: 'target.txt', newContent: '', operation: 'delete' }]);
  await fs.unlink(target);
  await fs.symlink(other, target, 'junction');
  await assert.rejects(engine.applyProposal(proposal.id), /regular file/);
  assert.equal(await fs.readFile(path.join(other, 'preserved.txt'), 'utf8'), 'same bytes');
}));

test('missing edit-engine context cannot silently bypass reviewed file operations', async () => fixture(async ({ root }) => {
  await fs.writeFile(path.join(root, 'existing.txt'), 'original');
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, {});
  for (const [name, args] of [
    ['write_file', { path: 'existing.txt', content: 'unsafe' }],
    ['create_file', { path: 'new.txt', content: 'unsafe' }],
    ['replace_range', { path: 'existing.txt', start_line: 1, end_line: 1, replacement: 'unsafe' }],
    ['delete_file', { path: 'existing.txt' }],
    ['move_file', { source_path: 'existing.txt', destination_path: 'new.txt' }]
  ]) await assert.rejects(registry.executeTool(name, args), /reviewed edit engine is unavailable/);
  assert.equal(await fs.readFile(path.join(root, 'existing.txt'), 'utf8'), 'original');
  await assert.rejects(fs.stat(path.join(root, 'new.txt')), { code: 'ENOENT' });
}));

test('the actual agent loop creates, fixes, moves, runs, and deletes a program with permissions and recoverable mutations', async () => fixture(async ({ root }) => {
  const editEngine = new EditEngine(storageFixture());
  const terminalManager = new TerminalManager();
  const registry = new ToolRegistry();
  registerAllCoreTools(registry, { editEngine, terminalManager, autoApply: true });
  const approvals = [];
  const permissions = new PermissionManager('always_ask', async (request) => { approvals.push(request.toolName); return true; });
  const actions = [
    ['create_file', { path: 'program.js', content: "console.log('first');\r\n" }],
    ['replace_range', { path: 'program.js', start_line: 1, end_line: 1, replacement: "console.log('VERIFIED_FILE_OPS');" }],
    ['move_file', { source_path: 'program.js', destination_path: 'moved.js' }],
    ['run_command', { command: 'node moved.js' }],
    ['delete_file', { path: 'moved.js' }]
  ];
  let round = 0;
  let commandResult;
  const provider = { id: 'scripted-file-workflow-fixture', chatWithTools: async () => {
    const action = actions[round++];
    return action ? { content: '', tool_calls: [{ function: { name: action[0], arguments: JSON.stringify(action[1]) } }] }
      : { content: 'Created, corrected, moved, executed, and removed the temporary program.' };
  } };
  try {
    const result = await new AgentLoop(provider, registry, permissions).run('scripted', [{ role: 'user', content: 'Create a temporary program, correct its output, move it, run it, and remove it.' }], {
      mode: 'agent', onToolEnd: (name, output) => { if (name === 'run_command') commandResult = output; }
    });
    assert.equal(result.state.status, 'completed', JSON.stringify(result.state.unresolvedErrors));
    assert.deepEqual(approvals, actions.map((action) => action[0]));
    assert.equal(commandResult.exitCode, 0);
    assert.equal(commandResult.stdout, 'VERIFIED_FILE_OPS');
    assert.equal(terminalManager.getAllProcesses()[0].status, 'completed');
    await assert.rejects(fs.stat(path.join(root, 'program.js')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, 'moved.js')), { code: 'ENOENT' });
    const history = editEngine.getRecoveryHistory();
    assert.equal(history.length, 4);
    for (const record of history) assert.equal((await editEngine.rollbackChanges(record.id)).success, true);
    await assert.rejects(fs.stat(path.join(root, 'program.js')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, 'moved.js')), { code: 'ENOENT' });
  } finally {
    for (const process of terminalManager.getRunningProcesses()) terminalManager.stopProcess(process.id);
  }
}));
