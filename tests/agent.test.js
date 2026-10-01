const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runToolAgent } = require('../dist/agent/toolAgent.js');
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');

test('AgentLoop streams safe model text before a response finishes', async () => {
  let providerFinished = false;
  const streamed = [];
  const provider = {
    id: 'streaming-fixture',
    chatWithTools: async (_model, _messages, _tools, _signal, onContentDelta) => {
      onContentDelta('Visible update ');
      onContentDelta('<think>private reasoning</think> after reasoning');
      await new Promise((resolve) => setTimeout(resolve, 5));
      providerFinished = true;
      return {
        role: 'assistant',
        content: 'Visible update <think>private reasoning</think> after reasoning'
      };
    }
  };

  const result = await new AgentLoop(provider, new ToolRegistry()).run('fixture:model', [
    { role: 'user', content: 'Explain the next step.' }
  ], {
    mode: 'ask',
    maxRounds: 1,
    onModelText: (text) => streamed.push({ text, providerFinished })
  });

  assert.equal(streamed.some((entry) => !entry.providerFinished), true);
  const visible = streamed.map((entry) => entry.text).join('');
  assert.match(visible, /Visible update/);
  assert.match(visible, /after reasoning/);
  assert.doesNotMatch(visible, /private reasoning|<think>/);
  assert.equal(result.response, 'Visible update  after reasoning');
});

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
  assert.match(answer, /I did not run commands\./);
  assert.match(answer, /tool actions failed/i);
  assert.equal(executed, false);
});

test('agent extracts and executes text-embedded <tool_call> blocks from local models', async () => {
  const executed = [];
  let call = 0;
  const provider = {
    id: 'local-ollama',
    chatWithTools: async () => {
      call += 1;
      if (call === 1) {
        return {
          role: 'assistant',
          content: 'Let me search.\n<tool_call>{"name": "search_workspace", "arguments": {"query": "auth"}}</tool_call>'
        };
      }
      return { role: 'assistant', content: 'Found auth in src/auth.ts.' };
    }
  };
  const answer = await runToolAgent(provider, 'qwen:1.5b', [{ role: 'user', content: 'Where is auth?' }], [
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } }
  ], async (name, args) => {
    executed.push([name, args]);
    return [{ path: 'src/auth.ts' }];
  });
  assert.equal(answer, 'Found auth in src/auth.ts.');
  assert.deepEqual(executed, [['search_workspace', { query: 'auth' }]]);
});

test('agent injects plan mode system instructions when mode is plan', async () => {
  let capturedSystemPrompt = '';
  const provider = {
    id: 'fixture',
    chatWithTools: async (_model, messages) => {
      capturedSystemPrompt = messages[0].content;
      return { role: 'assistant', content: '## Plan\n- [ ] Step 1' };
    }
  };
  const answer = await runToolAgent(provider, 'test:model', [{ role: 'user', content: 'Plan feature' }], [], async () => ({}), {
    mode: 'plan'
  });
  assert.match(capturedSystemPrompt, /Plan Mode/);
  assert.match(answer, /## Plan/);
});
