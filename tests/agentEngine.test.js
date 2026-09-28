const assert = require('node:assert/strict');
const { test } = require('node:test');

const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');

test('AgentLoop honors maxRounds step limits without infinite loops', async () => {
  let calls = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      calls += 1;
      return {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `call-${calls}`, function: { name: 'search_workspace', arguments: '{"query":"auth"}' } }]
      };
    }
  };

  const registry = new ToolRegistry();
  registry.registerTool(
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } },
    async () => [{ path: 'src/auth.ts' }]
  );

  const loop = new AgentLoop(provider, registry);
  const result = await loop.run('test-model', [{ role: 'user', content: 'Loop forever' }], {
    maxRounds: 3
  });

  assert.equal(calls, 3);
  assert.match(result.response, /reached the step limit/);
  assert.equal(result.state.steps.length, 3);
  assert.equal(result.state.status, 'completed');
});

test('AgentLoop halts immediately when AbortSignal is cancelled', async () => {
  const controller = new AbortController();
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      controller.abort();
      return {
        role: 'assistant',
        content: 'Cancelled next',
        tool_calls: [{ id: 'call-1', function: { name: 'search_workspace', arguments: '{"query":"cancel"}' } }]
      };
    }
  };

  const registry = new ToolRegistry();
  registry.registerTool(
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } },
    async () => []
  );

  const loop = new AgentLoop(provider, registry);
  await assert.rejects(
    () => loop.run('test-model', [{ role: 'user', content: 'Cancel me' }], { signal: controller.signal }),
    /cancelled/
  );
});

test('AgentLoop captures structured errors when tool execution fails', async () => {
  let call = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      call += 1;
      if (call === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'call-fail', function: { name: 'failing_tool', arguments: '{}' } }]
        };
      }
      return { role: 'assistant', content: 'Handled failure cleanly.' };
    }
  };

  const registry = new ToolRegistry();
  registry.registerTool(
    { type: 'function', function: { name: 'failing_tool', description: 'Fails', parameters: {} } },
    async () => { throw new Error('Disk full'); }
  );

  const loop = new AgentLoop(provider, registry);
  const result = await loop.run('test-model', [{ role: 'user', content: 'Run tool' }]);

  assert.equal(result.response, 'Handled failure cleanly.');
  assert.equal(result.state.errors.length, 1);
  assert.match(result.state.errors[0], /Disk full/);
});
