const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runToolAgent } = require('../dist/agent/toolAgent.js');

test('agent executes only allow-listed tools and returns the model conclusion', async () => {
  const requests = [];
  let call = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async (_model, messages) => {
      requests.push(messages);
      call += 1;
      if (call === 1) return {
        role: 'assistant', content: '',
        tool_calls: [{ id: 'call-1', function: { name: 'search_workspace', arguments: '{"query":"parser"}' } }]
      };
      return { role: 'assistant', content: 'The parser is in src/parser.ts.' };
    }
  };
  const executed = [];
  const answer = await runToolAgent(provider, 'test:model', [{ role: 'user', content: 'Find the parser.' }], [
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } }
  ], async (name, args) => {
    executed.push([name, args]);
    return [{ path: 'src/parser.ts', startLine: 1 }];
  });
  assert.equal(answer, 'The parser is in src/parser.ts.');
  assert.deepEqual(executed, [['search_workspace', { query: 'parser' }]]);
  assert.equal(requests[1].at(-1).role, 'tool');
  assert.equal(requests[1].at(-1).tool_call_id, 'call-1');
});

test('agent blocks tool calls that are not allow-listed', async () => {
  let executed = false;
  let call = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      call += 1;
      return call === 1
        ? { role: 'assistant', content: '', tool_calls: [{ id: 'bad', function: { name: 'run_shell', arguments: '{}' } }] }
        : { role: 'assistant', content: 'I did not run commands.' };
    }
  };
  const answer = await runToolAgent(provider, 'test:model', [{ role: 'user', content: 'Run a command.' }], [], async () => {
    executed = true;
    return {};
  });
  assert.equal(answer, 'I did not run commands.');
  assert.equal(executed, false);
});
