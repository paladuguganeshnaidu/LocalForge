const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdirTargets, resolvedDirectoryFailures } = require('../dist/agent/directoryRecovery');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const failure = () => ({ name: 'run_command', status: 'error', args: { command: 'mkdir -p public src/components' }, error: 'The syntax of the command is incorrect.' });
const created = path => ({ name: 'create_directory', status: 'success', args: { path }, result: { path, created: true } });

test('preparation recovery parses only simple relative mkdir requests without executing or rewriting them', () => {
  assert.deepEqual(mkdirTargets('mkdir -p public src/components'), ['public', 'src/components']);
  assert.deepEqual(mkdirTargets('mkdir "public files" && mkdir src\\components'), ['public files', 'src/components']);
  for (const command of ['mkdir ../outside', 'mkdir C:\\outside', 'mkdir public & echo OK', 'mkdir public > marker', 'mkdir public && npm test', 'mkdir $HOME', 'mkdir %TEMP%', 'mkdir public\nexit']) assert.deepEqual(mkdirTargets(command), []);
});

test('only actual later directory evidence resolves a preparation failure, not a plan, unrelated command or pending proposal', () => {
  assert.deepEqual(resolvedDirectoryFailures([failure(), created('public')]), []);
  assert.deepEqual(resolvedDirectoryFailures([failure(), created('public'), created('src/components')]), ['run_command:mkdir -p public src/components']);
  assert.deepEqual(resolvedDirectoryFailures([failure(), { ...created('public'), result: { proposed: true } }, created('src/components')]), []);
  assert.deepEqual(resolvedDirectoryFailures([{ ...failure(), error: 'Rejected by user' }, created('public'), created('src/components')]), []);
  assert.deepEqual(resolvedDirectoryFailures([failure(), { name: 'run_command', status: 'success', args: { command: 'echo OK' }, result: { exitCode: 0 } }]), []);
  assert.deepEqual(resolvedDirectoryFailures([created('public'), created('src/components'), failure()]), []);
  assert.deepEqual(resolvedDirectoryFailures([failure(), created('public'), created('src/components'), { name: 'run_command', status: 'success', args: { command: 'node mutate.cjs' }, result: { exitCode: 0 } }]), []);
});

test('the agent preserves historical syntax errors but accepts genuinely recovered directory initialization', async () => {
  const registry = new ToolRegistry();
  registry.registerTool({ type: 'function', function: { name: 'run_command', description: 'Execute command', parameters: {} } }, async () => ({ exitCode: 1, stderr: 'The syntax of the command is incorrect.' }));
  registry.registerTool({ type: 'function', function: { name: 'create_directory', description: 'Create real directory', parameters: {} } }, async args => ({ path: args.path, created: true }));
  let round = 0;
  const provider = { id: 'fixture', chatWithTools: async (_model, messages) => {
    assert.ok(messages[0].content.includes(process.platform === 'win32' ? 'Windows cmd.exe' : 'POSIX /bin/sh'));
    const actions = [{ name: 'run_command', arguments: { command: 'mkdir -p public src/components' } }, { name: 'create_directory', arguments: { path: 'public' } }, { name: 'create_directory', arguments: { path: 'src/components' } }];
    const action = actions[round++];
    return action ? { role: 'assistant', content: '', tool_calls: [{ function: action }] } : { role: 'assistant', content: 'Created the required directories using registered filesystem tools.' };
  } };
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_ask', async () => true)).run('fixture', [{ role: 'user', content: 'Initialize public and src/components directories.' }]);
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.errors.length, 1);
  assert.deepEqual(result.state.unresolvedErrors, []);
});
