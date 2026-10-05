const assert = require('node:assert/strict');
const test = require('node:test');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { registerWorkflowTools } = require('../dist/agent/workflowTools');
const { AgentLoop } = require('../dist/agent/agentLoop');

const definition = name => ({ type: 'function', function: { name, description: name, parameters: {} } });
const recipe = () => ({ name: 'workflow_inspect_project', description: 'Inspect actual files and project metadata', steps: [{ tool: 'read_file', args: { path: 'README.md' } }, { tool: 'inspect_project', args: {} }] });
function fixture(approval = async () => true, read = async () => ({ content: 'Actual file' })) {
  const registry = new ToolRegistry();
  const permissions = new PermissionManager('always_ask', approval);
  registry.registerTool(definition('read_file'), read);
  registry.registerTool(definition('inspect_project'), async () => ({ files: ['README.md'] }));
  registerWorkflowTools(registry, permissions);
  return { registry, permissions };
}

test('registration and invocation are real approved operations, not an independent built-in or a persistent alias', async () => {
  const approved = [];
  const { registry, permissions } = fixture(async request => { approved.push(request.toolName); return true; });
  const registered = await registry.executeTool('register_workflow_tool', recipe(), permissions);
  assert.equal(registered.registered, true);
  assert.equal(registered.independentBuiltinTool, false);
  const result = await registry.executeTool(registered.name, {}, permissions);
  assert.equal(result.success, true);
  assert.deepEqual(result.results.map(step => step.tool), ['read_file', 'inspect_project']);
  assert.deepEqual(approved, ['register_workflow_tool', registered.name]);
  assert.equal(registry.getTool(registered.name).source, 'custom');
  await assert.rejects(registry.executeTool(registered.name, { unsafe: true }, permissions), /fixed arguments/);
});

test('aliases, recursion, unknown handlers, invalid recipes and replacing built-ins are refused', async () => {
  const { registry, permissions } = fixture();
  for (const args of [{ ...recipe(), name: 'read_file' }, { ...recipe(), steps: [recipe().steps[0]] }, { ...recipe(), steps: [recipe().steps[0], recipe().steps[0]] }, { ...recipe(), steps: [{ tool: 'register_workflow_tool', args: recipe() }, recipe().steps[0]] }, { ...recipe(), steps: [{ tool: 'unregistered', args: {} }, recipe().steps[0]] }]) await assert.rejects(registry.executeTool('register_workflow_tool', args, permissions));
  assert.equal(registry.getAllTools().length, 3);
});

test('a denied registration never creates an executable handler; changed handlers cannot inherit a workflow approval', async () => {
  const denied = fixture(async () => false);
  await assert.rejects(denied.registry.executeTool('register_workflow_tool', recipe(), denied.permissions), /rejected/);
  assert.equal(denied.registry.hasTool(recipe().name), false);
  const { registry, permissions } = fixture();
  await registry.executeTool('register_workflow_tool', recipe(), permissions);
  registry.replaceTool(definition('read_file'), async () => ({ content: 'Replacement must not run' }));
  await assert.rejects(registry.executeTool(recipe().name, {}, permissions), /handler was replaced/);
});

test('failed and review-pending child operations stop the workflow without claiming successful completion', async () => {
  for (const result of [{ success: false, error: 'Real read failure' }, { proposed: true }, { exitCode: 1 }, { status: 'cancelled' }]) {
    let later = 0;
    const { registry, permissions } = fixture(undefined, async () => result);
    registry.replaceTool(definition('inspect_project'), async () => { later += 1; return {}; });
    await registry.executeTool('register_workflow_tool', recipe(), permissions);
    const output = await registry.executeTool(recipe().name, {}, permissions);
    assert.equal(output.success, false);
    assert.equal(output.results.length, 1);
    assert.equal(later, 0);
  }
});

test('newly approved tools become discoverable and executable on a later agent turn without expanding Ask mode', async () => {
  const { registry, permissions } = fixture();
  registry.registerTool({ type: 'function', function: { name: 'discover_tools', description: 'Discover registered names', parameters: {} } }, async args => ({ tools: registry.getDefinitions().filter(tool => tool.function.name === args.query) }));
  let rounds = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, _history, tools) => {
    rounds += 1;
    if (rounds === 1) return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'register_workflow_tool', arguments: recipe() } }] };
    if (rounds === 2) { assert.ok(tools.some(tool => tool.function.name === recipe().name)); return { role: 'assistant', content: '', tool_calls: [{ function: { name: recipe().name, arguments: {} } }] }; }
    return { role: 'assistant', content: 'Actual workflow inspected the file and project.' };
  } };
  const result = await new AgentLoop(provider, registry, permissions).run('fixture', [{ role: 'user', content: 'Register and execute an inspection workflow' }]);
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.steps.flatMap(step => step.toolCalls).at(-1).result.success, true);
  const reader = { id: 'fixture', chatWithTools: async (_model, _history, tools) => { assert.ok(!tools.some(tool => tool.function.name === recipe().name || tool.function.name === 'register_workflow_tool')); return { role: 'assistant', content: 'Read-only answer' }; } };
  await new AgentLoop(reader, registry, permissions).run('fixture', [{ role: 'user', content: 'Ask a question' }], { mode: 'ask' });
});
