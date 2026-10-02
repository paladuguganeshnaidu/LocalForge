const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AgentLoop } = require('../dist/agent/agentLoop');
const { ToolRegistry } = require('../dist/agent/toolRegistry');
const { OllamaProvider } = require('../dist/providers/ollamaProvider');
const { PermissionManager } = require('../dist/agent/permissionManager');
const { createRepositorySummaryFormatter, createRepositorySummaryValidator } = require('../dist/agent/summaryEvidence');

async function main() {
  const registry = new ToolRegistry();
  let reads = 0;
  registry.registerTool({ type: 'function', function: {
    name: 'read_file', description: 'Read a project file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
  } }, async (args) => {
    assert.equal(args.path, 'package.json');
    reads += 1;
    return { path: 'package.json', content: await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf8') };
  }, { category: 'read', riskLevel: 'read_only' });
  const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', () => ({ num_ctx: 8192, num_predict: 512, temperature: 0.1, seed: 7 }));
  const result = await new AgentLoop(provider, registry, new PermissionManager('always_ask', async () => false)).run(process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b', [{ role: 'user', content: 'Read package.json using read_file. Answer briefly with only ## Purpose (actual name and purpose), and ## Commands (copy the exact JSON values of scripts.build and scripts.test into code spans). No other commands. Do not write files.' }], {
    mode: 'ask', requireToolUse: true, maxRounds: 6, timeoutMs: 300000,
    validateFinalResponse: createRepositorySummaryValidator('Summary with actual name. Copy exact scripts.build and scripts.test.'),
    formatFinalResponse: createRepositorySummaryFormatter('Summary with actual name. Copy exact scripts.build and scripts.test.'),
    onModelOutput: (text, round, tools) => console.log(JSON.stringify({ round, tools, text })),
    onToolEnd: (name, _result, error) => console.log(JSON.stringify({ tool: name, error }))
  });
  console.log(result.response);
  assert.ok(reads > 0, 'The model must actually read the project');
  assert.equal(result.state.status, 'completed', result.response);
  assert.match(result.response, /#{1,6}\s+\w/);
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(result.response.includes(manifest.name));
  assert.ok(result.response.includes(manifest.scripts.build), 'The summary must copy the actual build script');
  assert.ok(result.response.includes(manifest.scripts.test), 'The summary must copy the actual test script');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
