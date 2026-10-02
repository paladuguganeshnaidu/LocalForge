const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

let declineEdits = false;
let writes = 0;
let statHook;
class FileSystemError extends Error {}
class WorkspaceEdit {
  constructor() { this.operations = []; }
  createFile(uri, options) { this.operations.push({ uri, create: true, content: options.contents }); }
  insert(uri, _position, content) { this.operations.push({ uri, content }); }
  replace(uri, _range, content) { this.operations.push({ uri, content }); }
}
const uri = (filePath) => ({ fsPath: filePath, path: filePath, scheme: 'file', toString: () => filePath });
const vscode = {
  FileSystemError, WorkspaceEdit,
  Position: class { constructor(line, character) { this.line = line; this.character = character; } },
  Range: class {},
  Uri: { joinPath: (root, ...segments) => uri(path.join(root.fsPath, ...segments)) },
  workspace: {
    isTrusted: true, workspaceFolders: [],
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
        if (operation.create) await fs.writeFile(operation.uri.fsPath, operation.content, { flag: 'wx' });
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
Module._load = originalLoad;
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { assertWorkspaceFilePath, validateWorkspaceRelativePath } = require('../dist/core/workspacePaths.js');

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
