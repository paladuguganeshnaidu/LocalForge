const assert = require('node:assert/strict');
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { OllamaProvider } = require('../dist/providers/ollamaProvider.js');
const { TerminalManager } = require('../dist/terminal/terminalManager.js');

const baseUrl = (process.env.LOCALFORGE_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const model = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
const expectedCommand = 'echo LOCALFORGE_COMMAND_OK';

async function main() {
  const provider = new OllamaProvider(baseUrl);
  console.log(`Connecting agent smoke test to ${baseUrl} using ${model}...`);
  const models = await provider.listModels();
  if (!models.some((item) => item.name === model)) {
    throw new Error(`Model "${model}" is not installed. Set LOCALFORGE_OLLAMA_MODEL to an installed model.`);
  }

  const toolRegistry = new ToolRegistry();
  let commandInvocations = 0;
  const permissionRequests = [];
  toolRegistry.registerTool({
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run the exact safe echo command for this smoke test; do not substitute another command.',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', enum: [expectedCommand] } },
        required: ['command'],
        additionalProperties: false
      }
    }
  }, async (args) => {
    assert.equal(args.command, expectedCommand, 'Only the harmless test command may be executed.');
    commandInvocations += 1;
    console.log(`Executing approved smoke command: ${args.command}`);
    const terminal = await new TerminalManager().runCommand(expectedCommand, process.cwd(), false, 15000);
    console.log(`Smoke command result: ${terminal.status}, exit ${terminal.exitCode}`);
    return terminal;
  }, { category: 'execute', riskLevel: 'low_risk', requiresApproval: true });

  const permissions = new PermissionManager('always_ask', async (request) => {
    permissionRequests.push(request);
    console.log(`Approval requested for ${request.toolName}: ${request.command || JSON.stringify(request.args)}`);
    return request.command === expectedCommand;
  });

  const progress = [];
  const visibleModelUpdates = [];
  console.log('Starting a one-command agent turn; the command requires explicit approval.');
  const result = await new AgentLoop(provider, toolRegistry, permissions).run(model, [{
    role: 'user',
    content: `For this isolated integration test, call the run_command tool exactly once with this exact command: "${expectedCommand}". Do not use any other command. After it succeeds, report its stdout verbatim.`
  }], {
    mode: 'agent',
    maxRounds: 4,
    signal: AbortSignal.timeout(180000),
    onProgress: (message) => { progress.push(message); console.log(`Agent: ${message}`); },
    onModelOutput: (text, round, tools) => visibleModelUpdates.push({ text, round, tools })
  });

  assert.equal(commandInvocations, 1, 'The real model must invoke the command tool exactly once.');
  assert.equal(permissionRequests.length, 1, 'The command must request user approval under always-ask mode.');
  assert.equal(permissionRequests[0].command, expectedCommand);
  assert.equal(result.state.status, 'completed', `Agent run did not complete: ${result.state.unresolvedErrors.join('; ')}`);
  assert.equal(result.state.steps.flatMap((step) => step.toolCalls).filter((call) => call.status === 'success').length, 1);
  assert.match(result.response, /LOCALFORGE_COMMAND_OK/);
  assert.ok(progress.filter((item) => item === 'Thinking').length >= 2, 'Agent must report thinking before tool selection and after receiving the command result.');
  assert.ok(progress.every((item) => !/model\s+\d+\s*\/\s*\d+/i.test(item)), 'User-visible progress must not expose model round counters.');

  console.log(`Real Ollama agent tool-use passed with ${model}.`);
  console.log(`Approved real command calls: ${commandInvocations}; permission prompts: ${permissionRequests.length}.`);
  console.log(`Final response includes LOCALFORGE_COMMAND_OK; visible model updates captured: ${visibleModelUpdates.length}.`);
  console.log(`Visible model updates captured: ${visibleModelUpdates.length}.`);
}

main().catch((error) => {
  console.error(`Ollama agent smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
