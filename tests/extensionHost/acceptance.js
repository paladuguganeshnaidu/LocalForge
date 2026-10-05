const assert = require('node:assert/strict');

function assertAgentAcceptance(result, phase) {
  assert.equal(result.summary?.status, 'completed', 'The real agent did not complete its task; test-host exit alone is not acceptance.');
  assert.equal(result.errors.length, 0, 'The native test has unresolved setup, execution or cleanup errors.');
  assert.equal(result.processCleanupPassed, true, 'Owned process cleanup must finish before terminal acceptance.');
  if (phase?.startsWith('graduated-')) assert.equal(result.independentTaskVerification?.passed, true, 'The generated task did not pass independent execution/content checks.');
  else if (phase === 'json-agent') assert.equal(result.typedJsonAgentPassed, true);
  else if (phase === 'machine-learning') assert.equal(result.independentMachineLearningVerification?.passed, true, 'Actual model artifacts and execution did not pass independent ML verification.');
  else {
    assert.equal(result.independentWebsiteVerification?.passed, true, 'Actual website execution and browser checks did not pass.');
    assert.equal(result.independentWebsiteVerification.profile, phase?.startsWith('minimal') || phase?.startsWith('micro') ? 'minimal' : 'full', 'Reduced-site evidence cannot certify the full website benchmark.');
    if (phase === 'minimal-verify') assert.equal(result.focusedExistingSiteVerificationPassed, true);
  }
}

module.exports = { assertAgentAcceptance };
