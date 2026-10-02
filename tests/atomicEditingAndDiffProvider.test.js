const { test } = require('node:test');
const assert = require('node:assert/strict');

// In-memory mock for vscode filesystem
const memoryFs = new Map();

class FileSystemError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileSystemError';
    this.code = 'FileNotFound';
  }
}

class EventEmitter {
  constructor() {
    this.listeners = [];
  }
  get event() {
    return (listener) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
  }
  fire(data) {
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

class WorkspaceEdit {
  constructor() { this.operations = []; }
  createFile(uri, options) { this.operations.push({ uri, create: true, content: options.contents }); }
  replace(uri, _range, content) { this.operations.push({ uri, content }); }
  insert(uri, _position, content) { this.operations.push({ uri, content }); }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      FileSystemError,
      FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
      EventEmitter,
      WorkspaceEdit,
      Range,
      Position,
      workspace: {
        isTrusted: true,
        openTextDocument: async () => ({ isDirty: false }),
        applyEdit: async (edit) => {
          const updated = new Map(memoryFs);
          for (const operation of edit.operations) {
            const key = operation.uri.fsPath.replace(/\\/g, '/');
            if (operation.create && updated.has(key)) return false;
            updated.set(key, Buffer.from(operation.content || ''));
          }
          memoryFs.clear();
          for (const [key, value] of updated) memoryFs.set(key, value);
          return true;
        },
        fs: {
          stat: async (uri) => {
            const key = uri.fsPath.replace(/\\/g, '/');
            if (!memoryFs.has(key)) throw new FileSystemError('Missing file');
            return { type: 1, size: memoryFs.get(key).length };
          },
          readFile: async (uri) => {
            const pathKey = (uri.fsPath || uri.path || String(uri)).replace(/\\/g, '/');
            if (!memoryFs.has(pathKey)) {
              const err = new FileSystemError(`File not found: ${pathKey}`);
              throw err;
            }
            return memoryFs.get(pathKey);
          },
          writeFile: async (uri, buffer) => {
            const pathKey = (uri.fsPath || uri.path || String(uri)).replace(/\\/g, '/');
            memoryFs.set(pathKey, Buffer.from(buffer));
          }
        }
      },
      Uri: {
        file: (path) => ({ fsPath: path.replace(/\\/g, '/'), path: path.replace(/\\/g, '/'), scheme: 'memfs', toString: () => `memfs:${path.replace(/\\/g, '/')}` }),
        joinPath: (base, ...segments) => {
          const combined = [base.fsPath || base.path, ...segments].join('/').replace(/\\/g, '/');
          return { fsPath: combined, path: combined, scheme: base.scheme };
        },
        parse: (str) => {
          const qIdx = str.indexOf('?');
          const schemeIdx = str.indexOf(':');
          const scheme = schemeIdx !== -1 ? str.slice(0, schemeIdx) : 'file';
          const path = qIdx !== -1 ? str.slice(schemeIdx + 1, qIdx) : str.slice(schemeIdx + 1);
          const query = qIdx !== -1 ? str.slice(qIdx + 1) : '';
          return {
            scheme,
            path,
            query,
            toString: () => str
          };
        }
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const vscode = require('vscode');
const { EditEngine, ProposedContentProvider } = require('../dist/editing/editEngine');

test('ProposedContentProvider provides proposed content for diff view', async () => {
  const engine = new EditEngine();
  const provider = new ProposedContentProvider(engine);
  const workspaceRoot = vscode.Uri.file('/mock/workspace');

  const proposal = await engine.proposeEdits(
    workspaceRoot,
    [
      { path: 'src/app.js', newContent: 'console.log("LocalForge working");' },
      { path: 'package.json', newContent: '{"name": "smoke"}' }
    ],
    'Smoke changes'
  );

  const uriApp = vscode.Uri.parse(`localforge-proposed:src/app.js?proposal=${proposal.id}`);
  const contentApp = provider.provideTextDocumentContent(uriApp);
  assert.equal(contentApp, 'console.log("LocalForge working");');

  const uriPkg = vscode.Uri.parse(`localforge-proposed:package.json?proposal=${proposal.id}`);
  const contentPkg = provider.provideTextDocumentContent(uriPkg);
  assert.equal(contentPkg, '{"name": "smoke"}');
  const originalNewFile = vscode.Uri.parse(`localforge-proposed:package.json?proposal=${proposal.id}&side=original`);
  assert.equal(provider.provideTextDocumentContent(originalNewFile), '');

  const uriUnknown = vscode.Uri.parse(`localforge-proposed:unknown.js?proposal=${proposal.id}`);
  assert.equal(provider.provideTextDocumentContent(uriUnknown), '');
});

test('Atomic multi-file apply validates all files and rejects when any file is stale', async () => {
  const engine = new EditEngine();
  const workspaceRoot = vscode.Uri.file('/mock/workspace');

  // Seed file in mock fs
  const file1Uri = vscode.Uri.joinPath(workspaceRoot, 'file1.txt');
  await vscode.workspace.fs.writeFile(file1Uri, Buffer.from('initial-content', 'utf8'));

  const proposal = await engine.proposeEdits(
    workspaceRoot,
    [
      { path: 'file1.txt', newContent: 'modified-content' },
      { path: 'file2.txt', newContent: 'new-file-content' }
    ],
    'Two-file change'
  );

  assert.equal(proposal.files.length, 2);
  assert.equal(proposal.status, 'pending');

  // Modify file1 manually to cause a stale state
  await vscode.workspace.fs.writeFile(file1Uri, Buffer.from('external-modification', 'utf8'));

  // Attempt apply
  const result = await engine.applyProposal(proposal.id);
  assert.equal(result.success, false);
  assert.equal(result.staleCount > 0, true);
  assert.equal(result.appliedCount, 0);

  // Verify file1 still has external modification, not overwritten
  const bytesAfter = await vscode.workspace.fs.readFile(file1Uri);
  assert.equal(bytesAfter.toString('utf8'), 'external-modification');
});

test('Atomic multi-file apply succeeds when all files are clean', async () => {
  const engine = new EditEngine();
  const workspaceRoot = vscode.Uri.file('/mock/workspace');

  const fileAUri = vscode.Uri.joinPath(workspaceRoot, 'cleanA.txt');
  await vscode.workspace.fs.writeFile(fileAUri, Buffer.from('clean-A-original', 'utf8'));

  const proposal = await engine.proposeEdits(
    workspaceRoot,
    [
      { path: 'cleanA.txt', newContent: 'clean-A-updated' },
      { path: 'cleanB.txt', newContent: 'clean-B-new' }
    ],
    'Clean multi-file update'
  );

  const result = await engine.applyProposal(proposal.id);
  assert.equal(result.success, true);
  assert.equal(result.appliedCount, 2);
  assert.equal(result.staleCount, 0);

  const bytesAfter = await vscode.workspace.fs.readFile(fileAUri);
  assert.equal(bytesAfter.toString('utf8'), 'clean-A-updated');
  const newFileBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceRoot, 'cleanB.txt'));
  assert.equal(newFileBytes.toString('utf8'), 'clean-B-new');
});
