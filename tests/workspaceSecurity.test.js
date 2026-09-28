const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { isTrusted: true, workspaceFolders: [] }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { validateRelativeWorkspacePath } = require('../dist/agent/workspaceTools.js');

test('validateRelativeWorkspacePath allows normal relative paths', () => {
  assert.deepEqual(validateRelativeWorkspacePath('src/utils.ts'), ['src', 'utils.ts']);
  assert.deepEqual(validateRelativeWorkspacePath('nested/deep/module/index.js'), ['nested', 'deep', 'module', 'index.js']);
  assert.deepEqual(validateRelativeWorkspacePath('README.md'), ['README.md']);
  // Windows backslash normalized
  assert.deepEqual(validateRelativeWorkspacePath('src\\agent\\toolAgent.ts'), ['src', 'agent', 'toolAgent.ts']);
});

test('validateRelativeWorkspacePath rejects directory traversal attacks', () => {
  assert.throws(() => validateRelativeWorkspacePath('../secret.env'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('src/../../etc/passwd'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('..'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('nested/./file.ts'), /normalized relative path/);
});

test('validateRelativeWorkspacePath rejects absolute paths and empty inputs', () => {
  assert.throws(() => validateRelativeWorkspacePath('/etc/shadow'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('C:/Windows/System32/calc.exe'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('D:\\Data\\file.txt'), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath(''), /normalized relative path/);
  assert.throws(() => validateRelativeWorkspacePath('   '), /normalized relative path/);
});
