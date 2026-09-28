const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: { activeTextEditor: undefined },
      workspace: { workspaceFolders: [], asRelativePath: (uri) => uri.fsPath },
      languages: { getDiagnostics: () => [] }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { ContextReferenceResolver } = require('../dist/context/referenceResolver.js');

test('ContextReferenceResolver parses all supported slash commands', () => {
  const resolver = new ContextReferenceResolver();

  const c1 = resolver.parseSlashCommand('/plan refactor authentication flow');
  assert.equal(c1.command, 'plan');
  assert.equal(c1.cleanPrompt, 'refactor authentication flow');

  const c2 = resolver.parseSlashCommand('/diff');
  assert.equal(c2.command, 'diff');
  assert.equal(c2.cleanPrompt, '');

  const c3 = resolver.parseSlashCommand('/search user registration');
  assert.equal(c3.command, 'search');
  assert.equal(c3.cleanPrompt, 'user registration');

  const c4 = resolver.parseSlashCommand('/terminal npm test');
  assert.equal(c4.command, 'terminal');
  assert.equal(c4.cleanPrompt, 'npm test');

  const c5 = resolver.parseSlashCommand('/clear');
  assert.equal(c5.command, 'clear');

  const c6 = resolver.parseSlashCommand('normal prompt without slash');
  assert.equal(c6.command, undefined);
  assert.equal(c6.cleanPrompt, 'normal prompt without slash');
});

test('ContextReferenceResolver strips @ references from prompt text', async () => {
  const resolver = new ContextReferenceResolver();

  const res = await resolver.resolveReferences('@file explain the middleware and @selection check errors');
  assert.ok(!res.cleanedPrompt.includes('@selection'));
});
