const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { ToolRegistry } = require('../dist/agent/toolRegistry');

test('agent marks a non-zero command result as a tool warning and passes it back to the model', async () => {
  let requestCount = 0;
  let activityError;
  const provider = {
    id: 'fixture',
    chatWithTools: async (_model, messages) => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'command-1', function: { name: 'run_command', arguments: '{"command":"npm test"}' } }]
        };
      }
      assert.match(messages.at(-1).content, /exitCode|stderr|failed/i);
      return { role: 'assistant', content: 'The test command failed; I have not claimed success.' };
    }
  };
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'run_command', description: 'Run test', parameters: {} } }],
    executeTool: async () => ({ command: 'npm test', exitCode: 1, stderr: '1 test failed' })
  };
  const loop = new AgentLoop(provider, tools);
  const result = await loop.run('fixture-model', [{ role: 'user', content: 'Run tests.' }], {
    mode: 'agent',
    onToolEnd: (_name, _value, error) => { activityError = error; }
  });

  assert.equal(result.state.status, 'failed');
  assert.match(result.state.unresolvedErrors[0], /1 test failed/);
  assert.doesNotMatch(result.response, /Task completed/i);
  assert.match(activityError, /exited with code 1/);
  assert.match(result.state.errors[0], /1 test failed/);
  assert.equal(requestCount, 4, 'A failed command gets bounded recovery attempts before the agent ends the turn');
});

test('agent never reports generic success when the model returns an empty answer', async () => {
  const loop = new AgentLoop({
    id: 'empty-fixture',
    chatWithTools: async () => ({ role: 'assistant', content: '' })
  }, {
    getDefinitions: () => [],
    executeTool: async () => ({})
  });
  const result = await loop.run('empty-model', [{ role: 'user', content: 'Hello.' }], { mode: 'ask' });

  assert.match(result.response, /empty response/i);
  assert.doesNotMatch(result.response, /Task completed/i);
});

test('agent summarizes verified tool outcomes when the model omits its final response', async () => {
  const provider = {
    id: 'empty-after-tools-fixture',
    chatWithTools: async () => ({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'write-1', function: { name: 'write_workspace_file', arguments: '{"path":"src/new.ts","content":"export {};"}' } },
        { id: 'command-1', function: { name: 'run_command', arguments: '{"command":"npm test"}' } }
      ]
    })
  };
  const tools = {
    getDefinitions: () => [
      { type: 'function', function: { name: 'write_workspace_file', description: 'Propose a file change', parameters: {} } },
      { type: 'function', function: { name: 'run_command', description: 'Run a command', parameters: {} } }
    ],
    executeTool: async (name) => name === 'write_workspace_file'
      ? { success: true, path: 'src/new.ts', proposalId: 'proposal-1', status: 'pending', proposed: true }
      : { command: 'npm test', status: 'completed', exitCode: 0, stdout: 'private output' }
  };
  const result = await new AgentLoop(provider, tools).run('fixture-model', [
    { role: 'user', content: 'Make a file change and run tests.' }
  ], { maxRounds: 1 });

  assert.equal(result.state.status, 'completed');
  assert.match(result.response, /did not provide a written summary/i);
  assert.match(result.response, /src\/new\.ts \(not applied\)/);
  assert.match(result.response, /Command finished with exit code 0/);
  assert.doesNotMatch(result.response, /private output/);
});

test('agent marks structured unsuccessful edit results as failures in the activity feed', async () => {
  const provider = {
    id: 'fixture',
    chatWithTools: async (_model, _messages) => ({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'edit-1', function: { name: 'edit_workspace_file', arguments: '{"path":"src/a.ts"}' } }]
    })
  };
  let activityError;
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'edit_workspace_file', description: 'Edit file', parameters: {} } }],
    executeTool: async () => ({ success: false, error: 'Source changed before apply.' })
  };
  const loop = new AgentLoop(provider, tools);
  const result = await loop.run('fixture-model', [{ role: 'user', content: 'Edit the file.' }], {
    mode: 'agent',
    maxRounds: 1,
    onToolEnd: (_name, _value, error) => { activityError = error; }
  });

  assert.equal(activityError, 'Source changed before apply.');
  assert.match(result.state.errors[0], /Source changed/);
});

test('agent refuses to claim completion after an edit tool fails and removes raw error JSON', async () => {
  let requestCount = 0;
  const modelUpdates = [];
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'edit-fail', function: { name: 'edit_workspace_file', arguments: '{"path":".prettierignore","target_content":"","replacement_content":"x"}' } }]
        };
      }
      return { role: 'assistant', content: 'Task completed.\n{"error":"Tool argument target_content must be a non-empty string."}' };
    }
  };
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'edit_workspace_file', description: 'Edit file', parameters: {} } }],
    executeTool: async () => { throw new Error('Tool argument target_content must be a non-empty string.'); }
  };
  const result = await new AgentLoop(provider, tools).run('fixture-model', [{ role: 'user', content: 'Edit the ignore file.' }], {
    onModelOutput: (text, round) => modelUpdates.push({ text, round })
  });

  assert.match(result.response, /could not verify successful completion/i);
  assert.match(result.response, /tool actions failed/i);
  assert.doesNotMatch(result.response, /\{"error"/i);
  assert.equal(result.state.errors.length, 1);
  assert.equal(result.state.status, 'failed');
  assert.equal(result.state.unresolvedErrors.length, 1);
  assert.ok(requestCount > 2, 'Agent retries instead of stopping on the model\'s unsupported completion claim');
  assert.ok(modelUpdates.some((update) => update.text.includes('Task completed.')), 'The visible model response is captured for run inspection');
});

test('agent recovers from an empty edit target by retrying after the tool error', async () => {
  let requestCount = 0;
  let toolCount = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return { role: 'assistant', content: '', tool_calls: [{ id: 'bad-edit', function: { name: 'edit_workspace_file', arguments: '{"path":".prettierignore","target_content":"","replacement_content":"new"}' } }] };
      }
      if (requestCount === 2) return { role: 'assistant', content: 'Task completed.' };
      if (requestCount === 3) {
        return { role: 'assistant', content: '', tool_calls: [{ id: 'retry-edit', function: { name: 'edit_workspace_file', arguments: '{"path":".prettierignore","target_content":"old","replacement_content":"new"}' } }] };
      }
      return { role: 'assistant', content: 'Updated .prettierignore after reading the failed edit result.' };
    }
  };
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'edit_workspace_file', description: 'Edit file', parameters: {} } }],
    executeTool: async (_name, args) => {
      toolCount += 1;
      if (!args.target_content) throw new Error('Tool argument target_content must be a non-empty string.');
      return { success: true, path: args.path, applied: true };
    }
  };

  const result = await new AgentLoop(provider, tools).run('fixture-model', [{ role: 'user', content: 'Edit the ignore file.' }]);

  assert.equal(requestCount, 4);
  assert.equal(toolCount, 2);
  assert.equal(result.state.status, 'completed');
  assert.deepEqual(result.state.unresolvedErrors, []);
  assert.equal(result.response, 'Updated .prettierignore after reading the failed edit result.');
  assert.equal(result.state.errors.length, 1, 'The original failed attempt remains in inspectable run history');
});

test('agent reuses the result of an identical consecutive tool call instead of executing twice', async () => {
  let requestCount = 0;
  let executions = 0;
  const approvalRequests = [];
  const command = 'echo TEST_OK';
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      requestCount += 1;
      if (requestCount <= 2) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: `command-${requestCount}`, function: { name: 'run_command', arguments: JSON.stringify({ command }) } }]
        };
      }
      return { role: 'assistant', content: 'The command completed with TEST_OK.' };
    }
  };
  const registry = new ToolRegistry();
  registry.registerTool({
    type: 'function',
    function: { name: 'run_command', description: 'Run a command.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }
  }, async () => {
    executions += 1;
    return { command, status: 'completed', exitCode: 0, stdout: 'TEST_OK' };
  }, { category: 'execute', riskLevel: 'low_risk', requiresApproval: true });
  const permissions = new PermissionManager('always_ask', async (request) => {
    approvalRequests.push(request.command);
    return true;
  });

  const result = await new AgentLoop(provider, registry, permissions).run('fixture-model', [{ role: 'user', content: 'Run the harmless command.' }]);
  const callRecords = result.state.steps.flatMap((step) => step.toolCalls);

  assert.equal(requestCount, 3);
  assert.equal(executions, 1);
  assert.deepEqual(approvalRequests, [command]);
  assert.equal(callRecords[1].result.duplicateSuppressed, true);
  assert.match(JSON.stringify(callRecords[1].result), /reused without running it again/);
  assert.equal(result.state.status, 'completed');
});

test('agent reports only visible model narration and tool names as inspectable model updates', async () => {
  let output;
  let calls = 0;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => {
      calls += 1;
      return calls === 1
        ? { role: 'assistant', content: 'I will inspect the file first.', tool_calls: [{ id: 'read-1', function: { name: 'read_workspace_file', arguments: '{"path":"src/a.ts"}' } }] }
        : { role: 'assistant', content: 'Here is the result.' };
    }
  };
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'read_workspace_file', description: 'Read', parameters: {} } }],
    executeTool: async () => ({ content: 'source' })
  };
  await new AgentLoop(provider, tools).run('fixture-model', [{ role: 'user', content: 'Inspect the file.' }], {
    onModelOutput: (text, round, toolNames) => {
      if (toolNames.length) output = { text, round, toolNames };
    }
  });

  assert.deepEqual(output, { text: 'I will inspect the file first.', round: 1, toolNames: ['read_workspace_file'] });
});

test('agent treats terminal manager failed status as an error even when exitCode is absent', async () => {
  let activityError;
  const provider = {
    id: 'fixture',
    chatWithTools: async () => ({
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'command-failed', function: { name: 'run_command', arguments: '{"command":"npm test"}' } }]
    })
  };
  const tools = {
    getDefinitions: () => [{ type: 'function', function: { name: 'run_command', description: 'Run test', parameters: {} } }],
    executeTool: async () => ({ status: 'failed', stderr: 'Process error: spawn EPERM' })
  };
  const result = await new AgentLoop(provider, tools).run('fixture-model', [{ role: 'user', content: 'Run tests.' }], {
    maxRounds: 1,
    onToolEnd: (_name, _result, error) => { activityError = error; }
  });

  assert.match(activityError, /Command failed: Process error: spawn EPERM/);
  assert.equal(result.state.errors.length, 1);
  assert.match(result.response, /tool actions failed/i);
});
