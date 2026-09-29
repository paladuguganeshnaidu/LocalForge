const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parseModelTurn } = require('../dist/agent/toolCallParser.js');
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');

test('tool parser never leaks supported tool JSON into user-visible text', () => {
  const payload = JSON.stringify({ name: 'search_workspace', arguments: { query: 'auth' } });
  const cases = [
    payload,
    '```json\\n' + payload + '\\n```',
    '<tool_call>' + payload + '</tool_call>',
    'LOCALFORGE_TOOL_CALL\\n' + payload,
    'I will search.\\n' + payload
  ];
  for (const input of cases) {
    const parsed = parseModelTurn(input);
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0].function.name, 'search_workspace');
    assert.equal(/\\\"name\\\"\\s*:\\s*\\\"search_workspace\\\"/.test(parsed.userVisibleText), false);
  }
});

test('tool parser handles 1000 generated tool-call payloads without leaking raw JSON', () => {
  for (let i = 0; i < 1000; i += 1) {
    const query = 'query-' + i;
    const payload = JSON.stringify({ tool: 'search_workspace', args: { query } });
    const parsed = parseModelTurn(i % 3 === 0 ? payload : 'Prefix\\n' + payload + '\\nSuffix');
    assert.equal(parsed.toolCalls.length, 1);
    assert.equal(parsed.toolCalls[0].function.name, 'search_workspace');
    assert.match(parsed.toolCalls[0].function.arguments, new RegExp('query-' + i));
    assert.equal(parsed.userVisibleText.includes(payload), false);
  }
});

test('AgentLoop executes plain JSON compatibility tool calls and returns only visible text', async () => {
  let calls = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      calls += 1;
      if (calls === 1) {
        return { role: 'assistant', content: 'I will inspect the workspace.\\n' + JSON.stringify({ name: 'search_workspace', arguments: { query: 'auth' } }) };
      }
      return { role: 'assistant', content: 'Found authentication in src/auth.ts.' };
    }
  };
  const registry = new ToolRegistry();
  let executed = 0;
  registry.registerTool(
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } },
    async () => { executed += 1; return [{ path: 'src/auth.ts' }]; }
  );
  const loop = new AgentLoop(provider, registry);
  const result = await loop.run('fixture:model', [{ role: 'user', content: 'Find auth.' }], { maxRounds: 3 });
  assert.equal(executed, 1);
  assert.equal(result.response, 'Found authentication in src/auth.ts.');
  assert.equal(result.response.includes('search_workspace'), false);
});

test('ToolRegistry converts workspace writes into approval proposals instead of direct writes', async () => {
  const registry = new ToolRegistry();
  let directWriteExecuted = false;
  registry.registerTool(
    { type: 'function', function: { name: 'write_workspace_file', description: 'Write', parameters: {} } },
    async () => { directWriteExecuted = true; return { success: true }; }
  );
  registry.setEditProposalHandler(async () => ({ requiresApproval: true, proposalId: 'proposal-1', message: 'Review changes.' }));
  const result = await registry.executeTool('write_workspace_file', { path: 'src/hello.js', content: 'console.log(1);' });
  assert.equal(directWriteExecuted, false);
  assert.equal(result.requiresApproval, true);
  assert.equal(result.proposalId, 'proposal-1');
});
