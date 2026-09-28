const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        isTrusted: true,
        fs: {
          readFile: async () => Buffer.from(''),
          writeFile: async () => {}
        }
      },
      Uri: {
        file: (path) => ({ fsPath: path, scheme: 'file' }),
        joinPath: (base, ...segments) => ({ fsPath: [base.fsPath, ...segments].join('/'), scheme: 'file' })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { computeContentHash, StaleEditError } = require('../dist/editing/patchService.js');
const { createUnifiedDiff } = require('../dist/editing/diffService.js');

test('atomic editing computes content hash accurately for empty, text, and modified states', () => {
  const emptyHash = computeContentHash('');
  assert.equal(emptyHash.length, 64);

  const initialContent = 'const a = 1;\nconst b = 2;\n';
  const initialHash = computeContentHash(initialContent);

  const modifiedContent = 'const a = 1;\nconst b = 3;\n';
  const modifiedHash = computeContentHash(modifiedContent);

  assert.notEqual(initialHash, modifiedHash);
  assert.notEqual(initialHash, emptyHash);
});

test('createUnifiedDiff generates clean unified diff with accurate additions and deletions', () => {
  const original = 'function foo() {\n  return 1;\n}\n';
  const modified = 'function foo() {\n  // updated\n  return 2;\n}\n';

  const diff = createUnifiedDiff('src/foo.ts', original, modified);
  assert.ok(diff.patch.includes('--- a/src/foo.ts'));
  assert.ok(diff.patch.includes('+++ b/src/foo.ts'));
  assert.ok(diff.stats.additions >= 2);
  assert.ok(diff.stats.deletions >= 1);
});

test('StaleEditError formats clear message with file path', () => {
  const err = new StaleEditError('src/auth.ts', 'hash-original', 'hash-current');
  assert.equal(err.name, 'StaleEditError');
  assert.equal(err.filePath, 'src/auth.ts');
  assert.match(err.message, /was modified after the edit proposal was created/);
});
