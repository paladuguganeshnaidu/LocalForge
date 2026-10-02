const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { createRepositorySummaryFormatter, createRepositorySummaryValidator } = require('../dist/agent/summaryEvidence');
const { isReadOnlyInspectionTask } = require('../dist/agent/taskIntent');

test('greetings and simple project summaries do not offer editing tools in Agent mode', async () => {
  assert.equal(isReadOnlyInspectionTask('hello'), true);
  assert.equal(isReadOnlyInspectionTask('read all project and say the summary'), true);
  assert.equal(isReadOnlyInspectionTask('summarize the project then fix the bug'), false);
  assert.equal(isReadOnlyInspectionTask('create a full web portfolio'), false);
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'read_file', description: 'Read', parameters: {} } }, async () => 'data', { category: 'read' });
  registry.registerTool({ type: 'function', function: { name: 'create_file', description: 'Create', parameters: {} } }, async () => { throw new Error('Must not execute'); }, { category: 'edit' });
  const provider = { id: 'fixture', chatWithTools: async (_model, messages, tools) => {
    assert.deepEqual(tools.map((tool) => tool.function.name), ['read_file']);
    assert.match(messages[0].content, /Do NOT write or edit files/);
    return { role: 'assistant', content: 'Hello! What would you like to build?' };
  } };
  const result = await new AgentLoop(provider, registry).run('model', [{ role: 'user', content: 'hello' }], { mode: 'agent', readOnlyInspection: true });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.mode, 'agent');
});

test('summary identity is sourced from verified file evidence, never fabricated without a successful read', () => {
  const format = createRepositorySummaryFormatter('Read the project and say the summary');
  const response = '## Purpose\nA coding extension';
  assert.equal(format(response, { steps: [] }), response);
  const state = { steps: [{ toolCalls: [{ name: 'read_file', status: 'success', args: { path: 'package.json' }, result: { content: '{"name":"actual-project"}' } }] }] };
  assert.match(format(response, state), /## Project: actual-project\nInspected source: `package.json`/);
  assert.equal(format('', state), '');
  state.steps[0].toolCalls.push({ name: 'read_file', status: 'success', args: { path: 'package.json' }, result: { content: '{"name":"new-project"}' } });
  assert.match(format(response, state), /## Project: new-project/);
  state.steps[0].toolCalls.pop();
  assert.equal(createRepositorySummaryFormatter('Explain a function')(response, state), response);
  state.steps[0].toolCalls[0].status = 'error';
  assert.equal(format(response, state), response);
});

function fixture() {
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'read_file', description: 'Read a workspace file', parameters: {} } }, async () => ({ content: JSON.stringify({ name: 'verified-project', scripts: { build: 'tsc -p .', test: 'node --test' } }) }));
  return registry;
}

test('a summary omitted identity or requested exact commands is corrected against actual evidence', async () => {
  const task = 'Summary with purpose. Copy exact scripts.build and scripts.test.';
  let rounds = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    rounds += 1;
    if (rounds === 1) return { role: 'assistant', content: '', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: { path: 'package.json' } } }] };
    if (rounds === 2) return { role: 'assistant', content: '## Purpose\nA project\n## Commands\nTry npm start' };
    assert.match(messages.at(-1).content, /verified-project/);
    assert.match(messages.at(-1).content, /tsc -p/);
    return { role: 'assistant', content: '## Purpose\nverified-project\n## Commands\n- `tsc -p .`\n- `node --test`' };
  } };
  const result = await new AgentLoop(provider, fixture()).run('model', [{ role: 'user', content: task }], { mode: 'ask', requireToolUse: true, validateFinalResponse: createRepositorySummaryValidator(task), maxRounds: 4 });
  assert.equal(rounds, 3);
  assert.equal(result.state.status, 'completed');
  assert.match(result.response, /verified-project/);
});

test('an uncorrected final-answer requirement is not falsely reported as completed', async () => {
  const task = 'Summary with purpose';
  let rounds = 0;
  const provider = { id: 'fixture', chatWithTools: async () => ++rounds === 1
    ? { role: 'assistant', content: '', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_file', arguments: { path: 'package.json' } } }] }
    : { role: 'assistant', content: '## Purpose\nAn unidentified project' } };
  const result = await new AgentLoop(provider, fixture()).run('model', [{ role: 'user', content: task }], { mode: 'ask', validateFinalResponse: createRepositorySummaryValidator(task), maxRounds: 8 });
  assert.equal(rounds, 4);
  assert.equal(result.state.status, 'failed');
  assert.match(result.response, /actual project identity/);
  assert.doesNotMatch(result.response, /Some tool actions failed/);
});
