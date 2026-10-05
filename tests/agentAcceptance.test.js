const assert = require('node:assert/strict');
const { test } = require('node:test');
const { assertAgentAcceptance } = require('./extensionHost/acceptance');

const completed = () => ({ summary: { status: 'completed' }, errors: [], processCleanupPassed: true, independentWebsiteVerification: { passed: true, profile: 'full' } });

test('native benchmark acceptance requires actual completion, execution, matching scope and cleanup', () => {
  assertAgentAcceptance(completed(), 'website');
  for (const result of [{ ...completed(), summary: undefined }, { ...completed(), summary: { status: 'failed' } }, { ...completed(), errors: ['runtime failed'] }, { ...completed(), processCleanupPassed: false }, { ...completed(), independentWebsiteVerification: { passed: false, profile: 'full' } }, { ...completed(), independentWebsiteVerification: { passed: true, profile: 'minimal' } }]) assert.throws(() => assertAgentAcceptance(result, 'website'));
  const focused = { ...completed(), independentWebsiteVerification: { passed: true, profile: 'minimal' }, focusedExistingSiteVerificationPassed: true };
  assertAgentAcceptance(focused, 'minimal-verify');
  assert.throws(() => assertAgentAcceptance({ ...focused, focusedExistingSiteVerificationPassed: false }, 'minimal-verify'));
});

test('ML and JSON acceptance cannot substitute unrelated website evidence for the requested task', () => {
  assert.throws(() => assertAgentAcceptance(completed(), 'machine-learning'));
  assertAgentAcceptance({ ...completed(), independentMachineLearningVerification: { passed: true } }, 'machine-learning');
  assert.throws(() => assertAgentAcceptance(completed(), 'json-agent'));
  assertAgentAcceptance({ ...completed(), typedJsonAgentPassed: true }, 'json-agent');
});
