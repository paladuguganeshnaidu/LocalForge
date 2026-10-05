const assert = require('node:assert/strict');
const { test } = require('node:test');

const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');

test('unchanged missing-file failures are dispatched only three times, with creation recovery guidance', async () => {
  let dispatched=0;
  const registry=new ToolRegistry();
  registry.registerTool({type:'function',function:{name:'read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}}}}},async()=>{dispatched+=1;throw new Error('ENOENT: no such file package.json');});
  const histories=[];
  const provider={id:'fixture',chatWithTools:async(_model,messages)=>{histories.push(structuredClone(messages));return {role:'assistant',content:'',tool_calls:[{id:'read-'+histories.length,function:{name:'read_file',arguments:'{"path":"package.json"}'}}]};}};
  const result=await new AgentLoop(provider,registry).run('fixture',[{role:'user',content:'Build a landing website in this empty workspace.'}],{mode:'agent',maxRounds:20});
  assert.equal(dispatched,3);
  assert.equal(result.state.status,'failed');
  assert.match(result.response,/unchanged failed action/);
  assert.ok(histories.some(messages=>messages.some(message=>message.content.includes('create_file or write_file and actual file content'))));
});

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
  assert.match(result.response, /did not provide a written summary/i);
  assert.match(result.response, /Completed search_workspace/);
  assert.equal(result.state.steps.length, 3);
  assert.equal(result.state.status, 'failed');
  assert.match(result.response, /task-round budget/);
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
    { name: 'AbortError' }
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
    async () => { throw new Error('Disk full'); },
    { category: 'read', riskLevel: 'read_only', requiresApproval: false, source: 'builtin' }
  );

  const loop = new AgentLoop(provider, registry);
  const result = await loop.run('test-model', [{ role: 'user', content: 'Run tool' }]);

  assert.match(result.response, /Handled failure cleanly/);
  assert.match(result.response, /tool actions failed/i);
  assert.equal(result.state.errors.length, 1);
  assert.match(result.state.errors[0], /Disk full/);
});
