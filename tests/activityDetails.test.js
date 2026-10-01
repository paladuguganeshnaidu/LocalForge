const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatToolInput, formatToolOutput } = require('../dist/core/activityDetails.js');

test('activity input shows commands while masking credential arguments', () => {
  const details = formatToolInput('run_command', {
    command: 'npm test --token hidden-value',
    apiKey: 'private-value'
  });

  assert.match(details, /npm test/);
  assert.doesNotMatch(details, /hidden-value|private-value/);
  assert.match(details, /REDACTED/);
});

test('activity output includes bounded command output and redacts secrets', () => {
  const details = formatToolOutput({
    cwd: 'C:/workspace',
    processId: 8124,
    status: 'failed',
    exitCode: 2,
    stdout: 'tests passed\ntoken=secret-value',
    stderr: 'failed check',
    credential: 'hidden-credential'
  });

  assert.match(details, /exitCode/);
  assert.match(details, /processId/);
  assert.match(details, /C:\/workspace/);
  assert.match(details, /tests passed/);
  assert.match(details, /failed check/);
  assert.doesNotMatch(details, /secret-value|hidden-credential/);
});

test('activity output reports failures without exposing credential-like values', () => {
  const details = formatToolOutput(undefined, 'Authorization: Bearer abc.def.ghi');

  assert.match(details, /Error/);
  assert.doesNotMatch(details, /abc\.def\.ghi/);
});
