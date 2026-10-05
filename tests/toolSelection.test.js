const assert = require('node:assert/strict');
const { test } = require('node:test');
const { selectToolDefinitions } = require('../dist/agent/toolSelection');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');

const definition = name => ({ type: 'function', function: { name, description: `Execute ${name}`, parameters: { type: 'object', properties: {} } } });

test('non-web requests prioritize execution/testing rather than a fixed browser/npm toolset', () => {
  const available = ['discover_tools', 'update_plan', 'list_directory', 'read_file', 'create_file', 'create_directory', 'write_file', 'edit_workspace_file', 'run_command', 'inspect_package_scripts', 'install_dependencies', 'install_packages', 'run_build', 'start_dev_server', 'process_status', 'browser_action', 'read_web_page', 'search_text', 'file_stat', 'run_tests', 'run_lint', 'delegate_task'].map(definition);
  for (const task of ['Train and test a Python classifier. No website or browser.', 'Create a CommonJS CLI and run its tests.', 'Clean CSV data and verify the saved summary.']) {
    const selected = selectToolDefinitions(available, 16, [], task).map(tool => tool.function.name);
    assert.ok(selected.includes('run_command') && selected.includes('run_tests') && selected.includes('delegate_task'));
    assert.ok(!selected.includes('browser_action') && !selected.includes('start_dev_server'));
    assert.ok(selected.length <= 16);
  }
  assert.ok(selectToolDefinitions(available, 16, [], 'Build and verify a website in a browser.').some(tool => tool.function.name === 'browser_action'));
  assert.equal(selectToolDefinitions(available, 4, ['browser_action'], 'Build a Python CLI.')[1].function.name, 'browser_action');
});

test('bounded tool selection retains discovery and exact requested registered schemas', () => {
  const available = ['discover_tools', 'list_directory', 'read_file', 'create_file', 'write_file', 'run_lint', 'stop_process'].map(definition);
  const selected = selectToolDefinitions(available, 4, ['run_lint', 'stop_process', 'unregistered']);
  assert.deepEqual(selected.map(tool => tool.function.name), ['discover_tools', 'run_lint', 'stop_process', 'list_directory']);
  assert.equal(selectToolDefinitions(available, 0), available);
});

test('a discovered tool becomes callable next turn without exceeding the schema budget', async () => {
  const registry = new ToolRegistry();
  const names = ['discover_tools', 'list_directory', 'read_file', 'create_file', 'write_file', 'run_lint'];
  let executions = 0;
  for (const name of names) registry.registerTool(definition(name), async () => name === 'discover_tools' ? { tools: [definition('run_lint')] } : (executions += 1, { exitCode: 0 }));
  let round = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, _messages, tools) => {
    round += 1;
    assert.ok(tools.length <= 4);
    if (round === 1) { assert.ok(!tools.some(tool => tool.function.name === 'run_lint')); return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'discover_tools', arguments: { query: 'run_lint' } } }] }; }
    if (round === 2) { assert.ok(tools.some(tool => tool.function.name === 'run_lint')); return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_lint', arguments: {} } }] }; }
    return { role: 'assistant', content: 'Lint succeeded.' };
  } };
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_proceed', async () => true)).run('fixture', [{ role: 'user', content: 'Run lint.' }], { maxToolDefinitions: 4 });
  assert.equal(executions, 1);
  assert.equal(result.state.status, 'completed');
});

test('discovery cannot expose write tools in read-only mode', async () => {
  const registry = new ToolRegistry();
  registry.registerTool(definition('discover_tools'), async () => ({ tools: [definition('create_file')] }));
  registry.registerTool(definition('create_file'), async () => { throw new Error('Write must not run'); });
  let round = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages, tools) => {
    assert.ok(!tools.some(tool => tool.function.name === 'create_file'));
    round += 1;
    if (round === 1) return { role: 'assistant', content: '', tool_calls: [{ function: { name: 'discover_tools', arguments: { query: 'create_file' } } }] };
    assert.deepEqual(JSON.parse(messages.at(-1).content).tools, []);
    return { role: 'assistant', content: 'Edits are not available in Ask mode.' };
  } };
  const result = await new AgentLoop(provider, registry).run('fixture', [{ role: 'user', content: 'Inspect available tools.' }], { mode: 'ask', maxToolDefinitions: 4 });
  assert.equal(result.state.status, 'completed');
});
