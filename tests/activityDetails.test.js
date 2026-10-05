const assert = require('node:assert/strict');
const { test } = require('node:test');
const { formatCommandLabel, formatToolInput, formatToolOutput } = require('../dist/core/activityDetails.js');

test('failed commands retain their actual stdout and stderr alongside redacted error details', () => {
  const rendered = formatToolOutput({ command: 'node --test math.test.cjs', exitCode: 1, stdout: 'TAP version 13\nReferenceError: test is not defined', stderr: '' }, 'Command exited with code 1');
  assert.match(rendered, /Error.*Command exited with code 1/s);
  assert.match(rendered, /ReferenceError: test is not defined/);
  assert.match(rendered, /node --test math.test.cjs/);
});

test('command titles show the exact test command and redact secret arguments', () => {
  assert.equal(formatCommandLabel('run_test', {}), 'npm test');
  assert.equal(formatCommandLabel('run_test', { test_filter: 'tests/sample.test.js' }), 'npm test -- "tests/sample.test.js"');
  assert.equal(formatCommandLabel('run_command', { command: 'npm test --token secret-value' }), 'npm test --token [REDACTED]');
  assert.equal(formatCommandLabel('start_dev_server', { command: 'python3 -m http.server 8080' }), 'python3 -m http.server 8080 --bind 127.0.0.1');
  assert.equal(formatCommandLabel('start_dev_server', { command: 'invalid server command' }), 'invalid server command');
});

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
