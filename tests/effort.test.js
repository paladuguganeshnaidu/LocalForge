const test = require('node:test');
const assert = require('node:assert/strict');
const { isAgentEffort, resolveEffortBudget } = require('../dist/agent/effort');
const { isWebviewMessage } = require('../dist/ui/webviewMessages');

test('effort IPC accepts exactly the four choices, not arbitrary object coercion', () => {
  for (const effort of ['low', 'medium', 'high', 'ultra']) assert.equal(isWebviewMessage({ type: 'setEffort', effort }), true);
  for (const effort of [null, {}, { toString: () => 'ultra' }, 'unlimited', 0, 'Ultra']) {
    assert.equal(isAgentEffort(effort), false);
    assert.equal(isWebviewMessage({ type: 'setEffort', effort }), false);
  }
});

test('effort changes real output, context and loop budgets without exceeding the configured memory ceiling', () => {
  const configured = { contextWindow: 32768, maxOutputTokens: -1, maxRounds: 320, historyCharacters: 100000 };
  const profiles = ['low', 'medium', 'high', 'ultra'].map(effort => resolveEffortBudget(effort, configured));
  assert.deepEqual(profiles.map(profile => profile.contextWindow), [4096, 8192, 16384, 32768]);
  assert.deepEqual(profiles.map(profile => profile.maxOutputTokens), [2048, 4096, 8192, -1]);
  assert.deepEqual(profiles.map(profile => profile.maxRounds), [24, 80, 160, 0]);
  assert.equal(resolveEffortBudget('ultra').contextWindow, 8192);
  for (const profile of profiles) assert.ok(profile.historyCharacters <= profile.contextWindow * 3);
  for (const effort of ['low', 'medium', 'high', 'ultra']) {
    const budget = resolveEffortBudget(effort, { contextWindow: 2048, maxRounds: 0, maxOutputTokens: 128 });
    assert.equal(budget.contextWindow, 2048);
    assert.equal(budget.maxRounds, 0);
    assert.equal(budget.maxOutputTokens, 128);
  }
  for (const settings of [{ contextWindow: Infinity }, { maxOutputTokens: -2 }, { maxRounds: -1 }, { historyCharacters: NaN }]) assert.throws(() => resolveEffortBudget('ultra', settings), /valid finite/);
});
