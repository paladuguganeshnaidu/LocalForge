const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
let files = new Map();
const originalLoad = Module._load;
const vscode = { Uri: { joinPath: (_root, name) => ({ name }) }, workspace: { fs: {
  readDirectory: async () => [...files.keys()].map(name => [name, 1]),
  readFile: async uri => Buffer.from(files.get(uri.name) || '')
} } };
Module._load = function(request) { return request === 'vscode' ? vscode : originalLoad.apply(this, arguments); };
const { ValidationEngine } = require('../dist/agent/validationEngine');
Module._load = originalLoad;

test('validation follows declared project tests instead of forcing npm/pytest on every project', async () => {
  const engine = new ValidationEngine();
  files = new Map();
  assert.equal((await engine.detectProject({})).testCommand, '');
  files = new Map([['package.json', '{"scripts":{"build":"node build.cjs"}}']]);
  assert.equal((await engine.detectProject({})).testCommand, '');
  files.set('package.json', '{"scripts":{"test":"node --test"}}');
  assert.equal((await engine.detectProject({})).testCommand, 'npm test');
  files = new Map([['train.py', ''], ['tests', '']]);
  assert.equal((await engine.detectProject({})).testCommand, 'python -m unittest discover -s tests -v');
  files.set('requirements.txt', 'pytest==8.0.0');
  assert.equal((await engine.detectProject({})).testCommand, 'python -m pytest');
  files = new Map([['train.py', '']]);
  assert.equal((await engine.detectProject({})).testCommand, '');
});
