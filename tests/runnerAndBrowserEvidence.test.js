const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RunnerProtocol } = require('../dist/runner/runnerProtocol');
const { ScopedVault } = require('../dist/runner/scopedVault');
const { BrowserEvidenceCollector } = require('../dist/browser/browserEvidence');
const { ChatProtocolValidator } = require('../dist/ui/chatProtocol');

test('RunnerProtocol serializes job submissions and parses progress/results', () => {
  const submission = {
    jobId: 'job-99',
    runId: 'run-101',
    goal: 'Run CI tests on remote runner',
    executionTier: 'remote_runner',
    maxDurationMs: 60000
  };

  const serialized = RunnerProtocol.serializeSubmission(submission);
  assert.ok(serialized.includes('JOB_SUBMIT'));
  assert.ok(serialized.includes('job-99'));

  // Progress message parsing
  const progressRaw = JSON.stringify({
    type: 'JOB_PROGRESS',
    payload: {
      jobId: 'job-99',
      step: 'Running tests',
      status: 'executing',
      timestamp: Date.now()
    }
  });
  const progress = RunnerProtocol.parseProgress(progressRaw);
  assert.equal(progress.jobId, 'job-99');
  assert.equal(progress.status, 'executing');

  // Result message parsing
  const resultRaw = JSON.stringify({
    type: 'JOB_RESULT',
    payload: {
      jobId: 'job-99',
      status: 'completed',
      exitCode: 0,
      summary: 'All 50 tests passed',
      filesModified: ['dist/out.js'],
      durationMs: 4200,
      artifacts: []
    }
  });
  const result = RunnerProtocol.parseResult(resultRaw);
  assert.equal(result.jobId, 'job-99');
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
});

test('ScopedVault issues, validates, and revokes ephemeral tokens with permissions and TTL', async () => {
  const vault = new ScopedVault();

  // Issue token with 'read' and 'git_push' permissions, 50ms TTL
  const token = vault.issueToken('job-1', ['read', 'git_push'], 50);
  assert.ok(token.startsWith('tk_'));

  // Valid permission check
  assert.equal(vault.validate(token, 'read').valid, true);
  assert.equal(vault.validate(token, 'git_push').valid, true);

  // Missing permission
  const missingPerm = vault.validate(token, 'delete_database');
  assert.equal(missingPerm.valid, false);
  assert.ok(missingPerm.reason.includes('lacks required permission'));

  // Revocation
  const revokedCount = vault.revokeJobTokens('job-1');
  assert.equal(revokedCount, 1);
  const afterRevoke = vault.validate(token, 'read');
  assert.equal(afterRevoke.valid, false);
  assert.ok(afterRevoke.reason.includes('revoked'));

  // TTL expiration
  const token2 = vault.issueToken('job-2', ['read'], 30);
  assert.equal(vault.validate(token2, 'read').valid, true);
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(vault.validate(token2, 'read').valid, false);
});

test('BrowserEvidenceCollector captures console messages and marks snapshot success or failure', () => {
  const collector = new BrowserEvidenceCollector();

  collector.recordConsoleMessage('log', 'Application started');
  collector.recordConsoleMessage('info', 'Listening on port 3000');

  // Clean snapshot without errors
  const cleanSnapshot = collector.createSnapshot('http://localhost:3000', 'Home Page', 200, 5);
  assert.equal(cleanSnapshot.hasConsoleErrors, false);
  assert.equal(cleanSnapshot.passed, true);
  assert.equal(cleanSnapshot.interactiveElementsCount, 5);

  // Snapshot with console error
  collector.recordConsoleMessage('error', 'Uncaught ReferenceError: foo is not defined');
  const errorSnapshot = collector.createSnapshot('http://localhost:3000', 'Home Page', 200, 5);
  assert.equal(errorSnapshot.hasConsoleErrors, true);
  assert.equal(errorSnapshot.passed, false);
});

test('ChatProtocolValidator validates inbound and outbound webview messages', () => {
  // Valid user prompt
  assert.equal(
    ChatProtocolValidator.validateInbound({ type: 'user_prompt', prompt: 'Refactor app' }).valid,
    true
  );

  // Invalid user prompt (empty)
  assert.equal(
    ChatProtocolValidator.validateInbound({ type: 'user_prompt', prompt: '' }).valid,
    false
  );

  // Valid approval
  assert.equal(
    ChatProtocolValidator.validateInbound({ type: 'approve_permission', requestId: 'req-1' }).valid,
    true
  );

  // Invalid approval (missing requestId)
  assert.equal(
    ChatProtocolValidator.validateInbound({ type: 'approve_permission' }).valid,
    false
  );

  // Unrecognized message type
  assert.equal(
    ChatProtocolValidator.validateInbound({ type: 'hack_the_planet' }).valid,
    false
  );
});
