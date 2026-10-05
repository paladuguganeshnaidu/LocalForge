const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolvedReplacedEditFailures } = require('../dist/agent/editRecovery');

test('obsolete exact-target edit errors resolve only after an applied full replacement and fresh exact readback', () => {
  const failed = { name: 'edit_workspace_file', args: { path: 'clean.cjs' }, status: 'error', error: 'Target content was not found in clean.cjs. Make sure whitespace and line breaks match.' };
  const write = { name: 'write_file', args: { path: 'clean.cjs', content: 'correct\n' }, status: 'success', result: { applied: true } };
  const read = { name: 'read_file', args: { path: 'clean.cjs' }, status: 'success', result: { content: 'correct\n' } };
  assert.deepEqual(resolvedReplacedEditFailures([failed, write, read]), ['edit_workspace_file:clean.cjs']);
  for (const calls of [[failed, read], [write, failed, read], [failed, { ...write, result: { proposed: true } }, read], [failed, write, { ...read, result: { content: 'correct\n', duplicateSuppressed: true } }], [failed, write, { ...read, result: { content: 'correct\n', truncated: true } }], [failed, write, { ...read, result: { content: 'different' } }], [{ ...failed, error: 'Could not save file; document remains dirty' }, write, read], [failed, { ...write, args: { path: 'other.cjs', content: 'correct\n' } }, read]]) assert.deepEqual(resolvedReplacedEditFailures(calls), []);
});
