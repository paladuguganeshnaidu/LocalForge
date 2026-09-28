const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ArtifactManager } = require('../dist/core/artifactManager.js');
const { TurnManager } = require('../dist/core/turnManager.js');

test('ArtifactManager creates, queries, and updates deliverable artifacts', () => {
  const am = new ArtifactManager();

  const plan = am.createArtifact({
    type: 'Implementation Plan',
    title: 'Add JWT Authentication',
    content: '## Objective\nAdd auth middleware',
    conversationId: 'conv-123',
    turnId: 'turn-456',
    relatedFiles: ['src/auth.ts', 'src/server.ts']
  });

  assert.ok(plan.id.startsWith('art-'));
  assert.equal(plan.status, 'pending');
  assert.equal(plan.relatedFiles.length, 2);

  // Status transition
  am.updateStatus(plan.id, 'approved');
  assert.equal(am.getArtifact(plan.id)?.status, 'approved');

  // Inline comment
  am.addComment(plan.id, { author: 'Reviewer', text: 'Looks great, proceed with step 2.' });
  const updated = am.getArtifact(plan.id);
  assert.equal(updated?.comments?.length, 1);
  assert.equal(updated?.comments?.[0].text, 'Looks great, proceed with step 2.');

  // Walkthrough creation
  const walkthrough = am.createWalkthrough({
    summary: 'Successfully added JWT authentication',
    filesChanged: ['src/auth.ts'],
    testsRun: 'npm test (47 passed)',
    validationResult: 'Passed',
    conversationId: 'conv-123'
  });

  assert.equal(walkthrough.type, 'Walkthrough');
  assert.match(walkthrough.content, /Successfully added JWT authentication/);
});

test('TurnManager records turns, operational activities, and tracks status', () => {
  const tm = new TurnManager();

  const turn = tm.startTurn({
    conversationId: 'conv-1',
    modelId: 'ollama:qwen',
    mode: 'agent',
    strategy: 'planning'
  });

  assert.equal(turn.turnNumber, 1);
  assert.equal(turn.status, 'running');

  // Add normalized operational activities
  const act1 = tm.addActivity(turn.turnId, {
    category: 'Searching',
    title: 'Searching workspace for "auth"',
    status: 'success'
  });

  const act2 = tm.addActivity(turn.turnId, {
    category: 'Reading',
    title: 'Reading src/auth.ts',
    targetPath: 'src/auth.ts',
    status: 'success'
  });

  assert.equal(turn.activities.length, 2);
  assert.equal(act1.category, 'Searching');
  assert.equal(act2.category, 'Reading');

  tm.completeTurn(turn.turnId, 'completed', ['src/auth.ts']);
  assert.equal(turn.status, 'completed');
  assert.equal(turn.filesChanged.length, 1);
});
