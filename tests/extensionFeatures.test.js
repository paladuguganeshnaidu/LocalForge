const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { isTrusted: true, getConfiguration: () => ({ get: () => '' }) },
      window: {},
      commands: {},
      Disposable: class { constructor(fn) { this.dispose = fn; } }
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  isWebviewMessage,
  cleanModelCodeOutput,
  formatExplainPrompt,
  formatFixPrompt
} = require('../dist/extension.js');

test('isWebviewMessage accepts valid control messages', () => {
  assert.equal(isWebviewMessage({ type: 'ready' }), true);
  assert.equal(isWebviewMessage({ type: 'refresh' }), true);
  assert.equal(isWebviewMessage({ type: 'cancel' }), true);
  assert.equal(isWebviewMessage({ type: 'clear' }), true);
  assert.equal(isWebviewMessage({ type: 'connectRemote' }), true);
  assert.equal(isWebviewMessage({ type: 'disconnectRemote' }), true);
  assert.equal(isWebviewMessage({ type: 'configureRemote' }), true);
  assert.equal(isWebviewMessage({ type: 'getRemoteStatus' }), true);
  assert.equal(isWebviewMessage({ type: 'selectModel', model: 'ollama:qwen2.5-coder' }), true);
  assert.equal(isWebviewMessage({ type: 'setMode', mode: 'agent' }), true);
  assert.equal(isWebviewMessage({ type: 'setMode', mode: 'plan' }), true);
  assert.equal(isWebviewMessage({ type: 'setMode', mode: 'ask' }), true);
  assert.equal(isWebviewMessage({ type: 'setMode', mode: 'invalid' }), false);
  assert.equal(isWebviewMessage({ type: 'setPermissionMode', mode: 'always_ask' }), true);
  assert.equal(isWebviewMessage({ type: 'setPermissionMode', mode: 'unknown' }), false);
  assert.equal(isWebviewMessage({ type: 'permissionResolved', requestId: 'perm-1', decision: 'allow' }), true);
  assert.equal(isWebviewMessage({ type: 'permissionResolved', requestId: 'perm-1', decision: 'allow_session' }), true);
  assert.equal(isWebviewMessage({ type: 'permissionResolved', requestId: 'perm-1', decision: 'always_allow' }), false);
});

test('isWebviewMessage validates chat payloads and rejects invalid inputs', () => {
  const validChat = {
    type: 'chat',
    model: 'ollama:qwen2.5-coder',
    prompt: 'How to write a unit test?',
    includeContext: true,
    includeWorkspace: false,
    agentMode: false
  };
  assert.equal(isWebviewMessage(validChat), true);

  // Missing required boolean field
  assert.equal(isWebviewMessage({ ...validChat, includeWorkspace: undefined }), false);
  // Unknown type
  assert.equal(isWebviewMessage({ type: 'unknownAction' }), false);
  // Null or primitive
  assert.equal(isWebviewMessage(null), false);
  assert.equal(isWebviewMessage('ready'), false);
  // Prompt over 20,000 chars
  assert.equal(isWebviewMessage({ ...validChat, prompt: 'x'.repeat(25000) }), false);
});

test('cleanModelCodeOutput removes wrapping markdown fences cleanly', () => {
  const fenced = '```typescript\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n```';
  assert.equal(
    cleanModelCodeOutput(fenced),
    'function add(a: number, b: number): number {\n  return a + b;\n}'
  );

  const raw = 'const greeting = "Hello";';
  assert.equal(cleanModelCodeOutput(raw), 'const greeting = "Hello";');
});

test('formatExplainPrompt embeds language, path, and bounded code', () => {
  const prompt = formatExplainPrompt('console.log("hello");', 'typescript', 'src/index.ts');
  assert.match(prompt, /src\/index\.ts/);
  assert.match(prompt, /typescript/);
  assert.match(prompt, /console\.log\("hello"\);/);
});

test('formatFixPrompt structures prompt and includes diagnostics when present', () => {
  const code = 'const x: number = "str";';
  const diagnostics = ['Type string is not assignable to type number.'];
  const messages = formatFixPrompt(code, 'typescript', 'src/file.ts', 'Fix type error', diagnostics);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.match(messages[1].content, /Reported issues\/diagnostics/);
  assert.match(messages[1].content, /Type string is not assignable to type number/);
  assert.match(messages[1].content, /Fix type error/);
});
