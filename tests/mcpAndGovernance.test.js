const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { McpHealthMonitor } = require('../dist/mcp/mcpHealth');
const { McpToolAdapter } = require('../dist/mcp/mcpToolAdapter');
const { HookEngine } = require('../dist/hooks/hookEngine');
const { RulesEngine } = require('../dist/rules/rulesEngine');
const { AgentProfileLoader } = require('../dist/agent/orchestration/agentProfileLoader');
const { AgentRegistry } = require('../dist/agent/orchestration/agentRegistry');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { PolicyBroker } = require('../dist/policy/policyBroker');
const { PermissionManager } = require('../dist/agent/permissionManager');

test('McpHealthMonitor trips circuit breaker on consecutive errors and resets upon success', () => {
  const monitor = new McpHealthMonitor(2);
  const serverId = 'test-server';

  assert.equal(monitor.isAvailable(serverId), true);

  // First failure -> degraded
  monitor.recordFailure(serverId, new Error('Network timeout'));
  assert.equal(monitor.isAvailable(serverId), true);
  assert.equal(monitor.getStats(serverId).state, 'degraded');

  // Second failure -> circuit tripped (failed)
  monitor.recordFailure(serverId, new Error('Process crash'));
  assert.equal(monitor.isAvailable(serverId), false);
  assert.equal(monitor.getStats(serverId).state, 'failed');

  // Reset circuit
  monitor.resetCircuit(serverId);
  assert.equal(monitor.isAvailable(serverId), true);
  assert.equal(monitor.getStats(serverId).state, 'healthy');
});

test('McpToolAdapter integrates MCP tools behind PolicyBroker gates', async () => {
  const toolRegistry = new ToolRegistry();
  const policyBroker = new PolicyBroker('allow_safe_auto');

  const mockClient = {
    config: { name: 'db_server' },
    callTool: async (name, args) => ({
      content: [{ type: 'text', text: `Result for ${name}: ${JSON.stringify(args)}` }],
      isError: false
    })
  };

  const tools = [
    {
      name: 'query_records',
      description: 'Run SQL query',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } }
    }
  ];

  McpToolAdapter.registerMcpTools(
    toolRegistry,
    mockClient,
    policyBroker,
    tools,
    path.resolve('.')
  );

  const defs = toolRegistry.getDefinitions();
  assert.ok(defs.some((d) => d.function.name === 'mcp_db_server_query_records'));

  const permissions = new PermissionManager('always_proceed', async () => true);
  // Execute MCP tool via registry
  const result = await toolRegistry.executeTool('mcp_db_server_query_records', { sql: 'SELECT 1' }, permissions);
  assert.ok(result.includes('MCP Tool Result: db_server/query_records'));
  assert.ok(result.includes('SELECT 1'));
});

test('HookEngine executes pre/post hooks and blocks operations when requested', async () => {
  const engine = new HookEngine();

  let postRunCalled = false;
  engine.registerHook({
    id: 'h1',
    name: 'Block dangerous file write',
    eventName: 'pre_file_write',
    priority: 1,
    handler: (ctx) => {
      if (ctx.data.path && ctx.data.path.includes('forbidden')) {
        return { allow: false, reason: 'File writing to forbidden path is disallowed.' };
      }
      return { allow: true };
    }
  });

  engine.registerHook({
    id: 'h2',
    name: 'Audit run complete',
    eventName: 'on_run_complete',
    priority: 10,
    handler: () => {
      postRunCalled = true;
    }
  });

  // Allowed file write
  const allowRes = await engine.trigger('pre_file_write', { path: 'src/app.ts' });
  assert.equal(allowRes.allow, true);

  // Blocked file write
  const blockRes = await engine.trigger('pre_file_write', { path: 'src/forbidden/secret.key' });
  assert.equal(blockRes.allow, false);
  assert.ok(blockRes.reason.includes('disallowed'));

  // Run complete hook
  await engine.trigger('on_run_complete', { runId: 'run-1' });
  assert.equal(postRunCalled, true);
});

test('RulesEngine loads AGENTS.md and scoped rules, matching them appropriately', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tuxnest-rules-'));
  await fs.mkdir(path.join(tempDir, '.tuxnest', 'rules'), { recursive: true });

  await fs.writeFile(
    path.join(tempDir, 'AGENTS.md'),
    '# Repository Rules\n- Use strict TypeScript\n- Add unit tests for every change'
  );

  await fs.writeFile(
    path.join(tempDir, '.tuxnest', 'rules', 'ui-rules.md'),
    'scope: src/ui/**\n- Use CSS modules for styles'
  );

  const engine = new RulesEngine(tempDir);
  await engine.loadWorkspaceRules();

  const rules = engine.getAllRules();
  assert.ok(rules.length >= 3); // core-security-policy + AGENTS.md + ui-rules.md

  // Rules for a general file
  const generalRules = engine.getRulesForFile('src/index.ts');
  assert.ok(generalRules.some((r) => r.source === 'AGENTS.md'));
  assert.ok(!generalRules.some((r) => r.source === '.tuxnest/rules/ui-rules.md'));

  // Rules for a UI file
  const uiRules = engine.getRulesForFile('src/ui/chat.ts');
  assert.ok(uiRules.some((r) => r.source === '.tuxnest/rules/ui-rules.md'));

  // Formatted prompt text
  const prompt = engine.formatRulesPrompt(['src/ui/chat.ts']);
  assert.ok(prompt.includes('GOVERNANCE & PROJECT RULES'));
  assert.ok(prompt.includes('Use strict TypeScript'));
  assert.ok(prompt.includes('Use CSS modules for styles'));

  await fs.rm(tempDir, { recursive: true, force: true });
});

test('AgentProfileLoader dynamically discovers custom agent profiles from markdown', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tuxnest-agents-'));
  await fs.mkdir(path.join(tempDir, '.tuxnest', 'agents'), { recursive: true });

  await fs.writeFile(
    path.join(tempDir, '.tuxnest', 'agents', 'security_auditor.md'),
    'name: Elite Security Auditor\ndescription: Specializes in deep OWASP and crypto audits\ntools: read, execute\n\nYou are the Elite Security Auditor.'
  );

  const profiles = await AgentProfileLoader.loadCustomProfiles(tempDir);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].role, 'security_auditor');
  assert.equal(profiles[0].displayName, 'Elite Security Auditor');
  assert.deepEqual(profiles[0].allowedToolCategories, ['read', 'execute']);

  assert.equal(AgentRegistry.isValidRole('security_auditor'), true);
  const def = AgentRegistry.getRole('security_auditor');
  assert.equal(def.displayName, 'Elite Security Auditor');

  await fs.rm(tempDir, { recursive: true, force: true });
});
