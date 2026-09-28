const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fingerprintMatches } = require('../dist/remote/sshOllamaTunnel.js');

test('requires a pinned SSH fingerprint and rejects changes', () => {
  assert.equal(fingerprintMatches(undefined, 'aa11'), false);
  assert.equal(fingerprintMatches('aa11', 'aa11'), true);
  assert.equal(fingerprintMatches('aa11', 'bb22'), false);
});
