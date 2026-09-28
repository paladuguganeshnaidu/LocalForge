const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PermissionManager } = require('../dist/agent/permissionManager.js');

test('PermissionManager rejects shell chaining and redirection in safe operations', () => {
  const pm = new PermissionManager('allow_safe_auto');

  // Direct safe commands are allowed
  assert.equal(pm.isSafeCommand('npm test'), true);
  assert.equal(pm.isSafeCommand('git status'), true);
  assert.equal(pm.isSafeCommand('cargo test'), true);
  assert.equal(pm.isSafeCommand('npm run build'), true);

  // Chained commands must be rejected in auto-safe mode
  assert.equal(pm.isSafeCommand('npm test && rm -rf dist'), false);
  assert.equal(pm.isSafeCommand('npm test || echo failed'), false);
  assert.equal(pm.isSafeCommand('git status; cat /etc/passwd'), false);
  assert.equal(pm.isSafeCommand('npm test | grep Error'), false);
  assert.equal(pm.isSafeCommand('npm test 2> error.log'), false);
  assert.equal(pm.isSafeCommand('npm test > output.txt'), false);
  assert.equal(pm.isSafeCommand('npm test &'), false);
  assert.equal(pm.isSafeCommand('npm test $(whoami)'), false);
  assert.equal(pm.isSafeCommand('npm test `whoami`'), false);
});

test('PermissionManager accurately classifies command categories', () => {
  const pm = new PermissionManager();

  assert.equal(pm.classifyCommand('git status'), 'version control');
  assert.equal(pm.classifyCommand('npm test'), 'test');
  assert.equal(pm.classifyCommand('pytest'), 'test');
  assert.equal(pm.classifyCommand('cargo build'), 'build');
  assert.equal(pm.classifyCommand('npm run build'), 'build');
  assert.equal(pm.classifyCommand('npm run lint'), 'lint');
  assert.equal(pm.classifyCommand('git commit -m "fix"'), 'version control');
  assert.equal(pm.classifyCommand('npm install'), 'package');
  assert.equal(pm.classifyCommand('curl http://example.com'), 'network');
  assert.equal(pm.classifyCommand('kill -9 1234'), 'process control');
  assert.equal(pm.classifyCommand('rm -rf /'), 'destructive');
});
