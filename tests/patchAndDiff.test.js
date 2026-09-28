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

const { createUnifiedDiff } = require('../dist/editing/diffService.js');
const { computeContentHash, StaleEditError } = require('../dist/editing/patchService.js');

test('createUnifiedDiff generates unified diff with additions and deletions', () => {
  const original = 'const a = 1;\nconst b = 2;\nconsole.log(a + b);';
  const modified = 'const a = 1;\nconst b = 3;\nconst c = 4;\nconsole.log(a + b + c);';

  const diff = createUnifiedDiff('src/math.ts', original, modified);
  assert.match(diff.patch, /--- a\/src\/math\.ts/);
  assert.match(diff.patch, /\+\+\+ b\/src\/math\.ts/);
  assert.match(diff.patch, /-const b = 2;/);
  assert.match(diff.patch, /\+const b = 3;/);
  assert.match(diff.patch, /\+const c = 4;/);

  assert.equal(diff.stats.additions, 3);
  assert.equal(diff.stats.deletions, 2);
});

test('computeContentHash generates deterministic SHA-256 hash', () => {
  const hash1 = computeContentHash('hello world');
  const hash2 = computeContentHash('hello world');
  const hash3 = computeContentHash('hello world!');

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.equal(hash1.length, 64);
});

test('StaleEditError conveys path and mismatch details', () => {
  const err = new StaleEditError('src/file.ts', 'hash-expected', 'hash-actual');
  assert.equal(err.name, 'StaleEditError');
  assert.equal(err.filePath, 'src/file.ts');
  assert.match(err.message, /was modified after the edit proposal was created/);
});
