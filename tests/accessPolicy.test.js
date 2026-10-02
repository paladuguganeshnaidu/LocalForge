const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AgentAccessPolicy } = require('../dist/agent/accessPolicy');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { registerExternalTools, validateResearchUrl } = require('../dist/agent/externalTools');
const { isWebviewMessage } = require('../dist/ui/webviewMessages');

test('File scope hides and blocks broad tools, other files and traversal before permissions', async () => {
  const policy = new AgentAccessPolicy();
  policy.setScope('file', 'src/app.ts');
  const registry = new ToolRegistry();
  registry.setAccessPolicy(policy);
  const permissions = new PermissionManager('always_proceed', async () => true);
  permissions.setAccessPolicy(policy);
  let executed = 0;
  for (const name of ['read_file', 'run_command', 'search_workspace', 'mcp_read', 'move_file']) registry.registerTool({ type: 'function', function: { name, description: name, parameters: {} } }, async () => { executed += 1; return 'ok'; });
  assert.deepEqual(registry.getDefinitions().map((tool) => tool.function.name), ['read_file']);
  assert.equal(await registry.executeTool('read_file', { path: 'src/app.ts' }, permissions), 'ok');
  for (const target of ['src/other.ts', '../secret', 'C:/secret']) await assert.rejects(registry.executeTool('read_file', { path: target }, permissions));
  for (const name of ['run_command', 'search_workspace', 'mcp_read', 'move_file']) await assert.rejects(registry.executeTool(name, { path: 'src/app.ts', command: 'npm test' }, permissions), /unavailable/);
  await assert.rejects(permissions.checkPermission('run_command', { command: 'npm test' }), /unavailable/);
  assert.equal(executed, 1);
});

test('machine file reads are hidden by default and need explicit per-action approval', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-access-'));
  const target = path.join(directory, 'approved.txt');
  await fs.writeFile(target, 'Machine fixture only');
  const registry = new ToolRegistry();
  const policy = new AgentAccessPolicy();
  registry.setAccessPolicy(policy);
  registerExternalTools(registry);
  try {
    assert.equal(registry.getDefinitions().some((tool) => tool.function.name === 'read_machine_file'), false);
    await assert.rejects(registry.executeTool('read_machine_file', { path: target }, new PermissionManager('always_proceed', async () => true)), /unavailable/);
    policy.setScope('machine');
    await assert.rejects(registry.executeTool('read_machine_file', { path: target }), /permission manager/);
    let requests = 0;
    const denied = new PermissionManager('always_proceed', async () => { requests += 1; return false; });
    await assert.rejects(registry.executeTool('read_machine_file', { path: target }, denied), /rejected/);
    assert.equal(requests, 1);
    const result = await registry.executeTool('read_machine_file', { path: target }, new PermissionManager('always_proceed', async (request) => { assert.equal(request.path, target); return true; }));
    assert.equal(result.content, 'Machine fixture only');
    const secret = path.join(directory, '.env');
    await fs.writeFile(secret, 'FIXTURE_SECRET=not-real');
    await assert.rejects(registry.executeTool('read_machine_file', { path: secret }, new PermissionManager('always_proceed', async () => true)), /additional confirmation/);
    await fs.unlink(secret);
    const privateKey = path.join(directory, 'fixture.pem');
    await fs.writeFile(privateKey, 'NOT-A-REAL-KEY');
    await assert.rejects(registry.executeTool('read_machine_file', { path: privateKey }, new PermissionManager('always_proceed', async () => true)), /additional confirmation/);
    await fs.unlink(privateKey);
    const listing = await registry.executeTool('list_machine_directory', { path: directory }, new PermissionManager('always_ask', async () => true));
    assert.equal(listing.entries[0].name, 'approved.txt');
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('resolved machine paths cannot bypass sensitive-file confirmation through a directory link', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'localforge-sensitive-path-'));
  const secrets = path.join(directory, '.ssh');
  const alias = path.join(directory, 'ordinary');
  try {
    await fs.mkdir(secrets);
    await fs.writeFile(path.join(secrets, 'config'), 'FIXTURE ONLY');
    await fs.symlink(secrets, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const registry = new ToolRegistry();
    const policy = new AgentAccessPolicy();
    policy.setScope('machine');
    registry.setAccessPolicy(policy);
    registerExternalTools(registry);
    await assert.rejects(registry.executeTool('read_machine_file', { path: path.join(alias, 'config') }, new PermissionManager('always_proceed', async () => true)), /resolved sensitive file/);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('internet access cannot be auto-approved, follows no redirects and enforces bounded reads', async () => {
  const registry = new ToolRegistry();
  registerExternalTools(registry);
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async (_url, options) => { fetches += 1; assert.equal(options.redirect, 'error'); return new Response('<title>Docs</title><script>secret()</script><p>API reference</p>', { headers: { 'content-type': 'text/html' } }); };
  try {
    await assert.rejects(registry.executeTool('read_web_page', { url: 'https://example.com/docs' }, new PermissionManager('always_proceed')), /rejected/);
    assert.equal(fetches, 0);
    const result = await registry.executeTool('read_web_page', { url: 'https://example.com/docs' }, new PermissionManager('always_proceed', async (request) => { assert.match(request.description, /Allow internet/); return true; }));
    assert.equal(result.url, 'https://example.com/docs');
    assert.match(result.content, /API reference/);
    assert.doesNotMatch(result.content, /secret/);
    global.fetch = async () => new Response('a'.repeat(1024 * 1024 + 1));
    await assert.rejects(registry.executeTool('read_web_page', { url: 'https://example.com/docs' }, new PermissionManager('always_ask', async () => true)), /1 MiB/);
    assert.throws(() => validateResearchUrl('http://example.com'), /HTTPS/);
    assert.throws(() => validateResearchUrl('https://user:pass@example.com'), /credentials/);
  } finally { global.fetch = originalFetch; }
});

test('network command approvals override safe/always policies and budget IPC rejects invalid values', async () => {
  let requested = 0;
  const permissions = new PermissionManager('always_proceed', async (request) => { requested += 1; assert.match(request.description, /network/); return false; });
  assert.equal(await permissions.checkPermission('run_command', { command: 'npm install astro' }), false);
  assert.equal(await permissions.checkPermission('run_command', { command: 'curl https://example.com' }), false);
  assert.equal(requested, 2);
  const sensitive = new PermissionManager('always_proceed', async (request) => { assert.match(request.description, /sensitive file/); return false; });
  assert.equal(await sensitive.checkPermission('read_workspace_file', { path: '.env' }, true), false);
  assert.equal(await sensitive.checkPermission('read_file', { path: 'private.pem' }, true), false);
  assert.equal(await sensitive.checkPermission('read_files', { paths: ['README.md', '.aws/credentials'] }, true), false);
  assert.equal(isWebviewMessage({ type: 'setAccessScope', scope: 'machine' }), true);
  assert.equal(isWebviewMessage({ type: 'setAccessScope', scope: 'admin' }), false);
  assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { 'agent.maxRounds': 0, 'ollama.maxOutputTokens': -1, 'ollama.contextWindow': 8192 } }), true);
  for (const value of [-1, 0.5, '0', NaN, Infinity, 10001]) assert.equal(isWebviewMessage({ type: 'updateSettings', settings: { 'agent.maxRounds': value } }), false);
});
