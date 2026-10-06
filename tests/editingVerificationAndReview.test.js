const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { LineEndingPreserver } = require('../dist/editing/lineEndingPreserver');
const { PatchValidator } = require('../dist/editing/patchValidator');
const { TransactionalEditEngine } = require('../dist/editing/transactionalEditEngine');
const { EvidencePlanner } = require('../dist/verification/evidencePlanner');
const { TestImpactAnalyzer } = require('../dist/verification/testImpactAnalyzer');
const { DebugController } = require('../dist/verification/debugController');
const { CodeReviewEngine } = require('../dist/review/codeReviewEngine');
const { SecurityReviewEngine } = require('../dist/review/securityReviewEngine');

test('LineEndingPreserver detects and maintains CRLF and LF formats', () => {
  const crlfContent = 'line 1\r\nline 2\r\nline 3';
  const lfContent = 'line 1\nline 2\nline 3';

  assert.equal(LineEndingPreserver.detectLineEnding(crlfContent), '\r\n');
  assert.equal(LineEndingPreserver.detectLineEnding(lfContent), '\n');

  const normalized = LineEndingPreserver.preserveOriginalFormat(crlfContent, 'new line 1\nnew line 2');
  assert.ok(normalized.includes('\r\n'));
  assert.ok(!normalized.includes('[^\r]\n'));
});

test('PatchValidator computes SHA-256 hashes and validates unique match count', () => {
  const sample = 'const a = 1;\nconst b = 2;\nconst c = 1;\n';
  const hash = PatchValidator.computeContentHash(sample);
  assert.ok(hash.length === 64);

  // Precondition matching
  assert.equal(PatchValidator.validatePrecondition(sample, hash).valid, true);
  assert.equal(PatchValidator.validatePrecondition(sample, 'wrong_hash').valid, false);

  // Uniqueness
  const single = PatchValidator.validateSingleTargetMatch(sample, 'const b = 2;');
  assert.equal(single.valid, true);
  assert.equal(single.matchCount, 1);

  const duplicate = PatchValidator.validateSingleTargetMatch(sample, 'const');
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.matchCount > 1);

  const missing = PatchValidator.validateSingleTargetMatch(sample, 'not_found');
  assert.equal(missing.valid, false);
  assert.equal(missing.matchCount, 0);
});

test('TransactionalEditEngine commits multi-file changes and rolls back atomically on failure', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tuxnest-tx-'));
  const file1 = path.join(tempDir, 'file1.txt');
  const file2 = path.join(tempDir, 'file2.txt');

  await fs.writeFile(file1, 'initial 1');
  await fs.writeFile(file2, 'initial 2');

  // Successful transaction
  const tx = await TransactionalEditEngine.applyTransaction([
    { filePath: file1, newContent: 'updated 1' },
    { filePath: file2, newContent: 'updated 2' }
  ]);

  assert.equal(await fs.readFile(file1, 'utf-8'), 'updated 1');
  assert.equal(await fs.readFile(file2, 'utf-8'), 'updated 2');

  // Rollback restores original content
  await tx.rollback();
  assert.equal(await fs.readFile(file1, 'utf-8'), 'initial 1');
  assert.equal(await fs.readFile(file2, 'utf-8'), 'initial 2');

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('EvidencePlanner plans steps, tracks artifacts, and scores verification completeness', () => {
  const planner = new EvidencePlanner();
  const steps = planner.planVerification(['src/core/engine.ts', 'tests/engine.test.js']);

  assert.ok(steps.some((s) => s.type === 'build'));
  assert.ok(steps.some((s) => s.type === 'test'));
  assert.ok(steps.some((s) => s.type === 'security'));

  // Initial score with no artifacts -> 0%
  const initialScore = planner.computeVerificationScore(steps);
  assert.equal(initialScore.passed, false);
  assert.equal(initialScore.score, 0);

  // Record passing build artifact
  planner.recordArtifact({
    type: 'build',
    producer: 'compiler',
    timestamp: Date.now(),
    summary: 'Compilation successful with 0 errors',
    passed: true
  });

  // Record passing test artifact
  planner.recordArtifact({
    type: 'test',
    producer: 'runner',
    timestamp: Date.now(),
    summary: '42 tests passed',
    passed: true
  });

  // Record passing security artifact
  planner.recordArtifact({
    type: 'security',
    producer: 'securityReviewEngine',
    timestamp: Date.now(),
    summary: 'Zero critical vulnerabilities found',
    passed: true
  });

  // Final score reaches 100%
  const finalScore = planner.computeVerificationScore(steps);
  assert.equal(finalScore.passed, true);
  assert.equal(finalScore.score, 100);
});

test('TestImpactAnalyzer selects minimal affected test files based on changed source', () => {
  const availableTests = [
    'tests/accessPolicy.test.js',
    'tests/runStateMachine.test.js',
    'tests/multiAgent.test.js'
  ];

  const result = TestImpactAnalyzer.selectImpactedTests(
    ['src/runtime/runStateMachine.ts'],
    availableTests
  );

  assert.equal(result.isComprehensiveFallback, false);
  assert.deepEqual(result.selectedTests, ['tests/runStateMachine.test.js']);
});

test('DebugController tracks failure signatures and identifies non-progressing loops', () => {
  const controller = new DebugController();
  const err = 'TypeError: Cannot read property foo of undefined at run.ts:12:4';

  const sig = controller.computeFailureSignature(err);
  assert.ok(sig.length > 0);

  // First attempt
  const a1 = controller.recordAttempt(sig, 'Add null check', 'Added if (!obj) return');
  assert.equal(a1.loopDetected, false);

  // Second attempt
  const a2 = controller.recordAttempt(sig, 'Optional chaining', 'Used obj?.foo');
  assert.equal(a2.loopDetected, false);

  // Third attempt triggers loop detector
  const a3 = controller.recordAttempt(sig, 'Default empty object', 'Used (obj || {}).foo');
  assert.equal(a3.loopDetected, true);
  assert.ok(a3.recommendation.includes('Repeated failure loop detected'));
});

test('CodeReviewEngine and SecurityReviewEngine detect code quality issues and CWE vulnerabilities', () => {
  const badCode = `
import * as child_process from 'child_process';

// TODO: Fix this insecure query later
export async function unsafeLogin(username: string, pass: any) {
  try {
    const query = \`SELECT * FROM users WHERE user = '\${username}'\`;
    const cmd = \`echo \${username}\`;
    child_process.exec(\`ls \${username}\`);
    document.getElementById('out').innerHTML = username;
  } catch () {
    // empty catch
  }
}
  `;

  // Code review findings
  const crFindings = CodeReviewEngine.reviewFile('src/auth.ts', badCode);
  const crSummary = CodeReviewEngine.summarize(crFindings);
  assert.equal(crSummary.passed, false);
  assert.ok(crFindings.some((f) => f.title.includes('TODO')));
  assert.ok(crFindings.some((f) => f.title.includes('Swallowed exception')));
  assert.ok(crFindings.some((f) => f.title.includes('any')));

  // Security review findings
  const secFindings = SecurityReviewEngine.scanFile('src/auth.ts', badCode);
  assert.ok(secFindings.some((f) => f.cwe === 'CWE-78')); // Command injection
  assert.ok(secFindings.some((f) => f.cwe === 'CWE-89')); // SQL injection
  assert.ok(secFindings.some((f) => f.cwe === 'CWE-79')); // XSS
});
