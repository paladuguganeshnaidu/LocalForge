const assert = require('node:assert/strict');
const { test } = require('node:test');
const { taskPlanDefinition, validateTaskPlan, modelWorkLabel } = require('../dist/agent/taskPlan');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');

const steps = [{ step: 'Choose the data and training approach', status: 'in_progress', phase: 'designing' }, { step: 'Implement and verify training', status: 'pending', phase: 'implementing' }];

test('task plans are bounded, distinct, copied and identify intentions rather than execution proof', () => {
  const plan = validateTaskPlan({ steps });
  assert.equal(plan.modelReported, true);
  assert.match(modelWorkLabel(plan), /Designing: Choose.*model plan/);
  plan.steps[0].step = 'Changed copy';
  assert.equal(steps[0].step, 'Choose the data and training approach');
  assert.throws(() => validateTaskPlan({ steps: [] }), /1–12/);
  assert.throws(() => validateTaskPlan({ steps: [steps[0], steps[0]] }), /distinct steps/);
  assert.throws(() => validateTaskPlan({ steps: [{ ...steps[0], step: 'bad\nstep' }] }), /single-line/);
  assert.match(modelWorkLabel(), /Planning the next action/);
  assert.equal(modelWorkLabel(undefined, { category: 'Running', status: 'success' }), 'Checking command results');
  assert.equal(modelWorkLabel(undefined, { category: 'Editing', status: 'success', applied: false }), 'Reviewing edit proposals');
  assert.match(modelWorkLabel(plan, { status: 'error' }), /Planning recovery/);
});

test('model-authored plans update progress but do not satisfy a required execution task', async () => {
  const registry = new ToolRegistry();
  registry.registerTool(taskPlanDefinition, async args => validateTaskPlan(args));
  let round = 0;
  const progress = [];
  const provider = { id: 'fixture', chatWithTools: async () => ++round === 1 ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'update_plan', arguments: { steps } } }] } : { role: 'assistant', content: 'All done.' } };
  const result = await new AgentLoop(provider, registry).run('fixture', [{ role: 'user', content: 'Implement and run a training project.' }], { maxRounds: 4, requireToolUse: true, onProgress: message => progress.push(message) });
  assert.equal(result.state.status, 'failed');
  assert.deepEqual(result.state.publicPlan.steps, steps);
  assert.ok(progress.some(message => /Designing/.test(message)));
  assert.ok(result.state.unresolvedErrors.some(message => /did not successfully inspect or execute/.test(message)));
});

test('agent progress distinguishes real generation from execution and does not bypass final evidence checks', async () => {
  const progress = [];
  const visible = [];
  const provider = { id: 'fixture', chatWithTools: async (_model, _messages, _tools, _signal, onContentDelta, onGenerationProgress) => {
    onGenerationProgress({ phase: 'thinking', receivedChunks: 1, contentCharacters: 0, toolCalls: 0 });
    onContentDelta('Unverified success claim.');
    onGenerationProgress({ phase: 'responding', receivedChunks: 2, contentCharacters: 25, toolCalls: 0 });
    return { role: 'assistant', content: 'Unverified success claim.' };
  } };
  const result = await new AgentLoop(provider, new ToolRegistry()).run('fixture', [{ role: 'user', content: 'Build and verify a website.' }], { maxRounds: 1, validateFinalResponse: () => 'No actual implementation or execution.', onProgress: message => progress.push(message), onModelText: text => visible.push(text) });
  assert.equal(result.state.status, 'failed');
  assert.ok(progress.includes('Thinking · 1 streamed updates received'));
  assert.ok(progress.includes('Generating a response · 2 streamed updates received'));
  assert.deepEqual(visible, []);
});
