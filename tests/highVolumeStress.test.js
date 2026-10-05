const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mock 'vscode' runtime module for pure unit testing outside of the VS Code host
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        isTrusted: true,
        workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
        fs: {
          readFile: async () => Buffer.from('console.log("hello world");\n'),
          writeFile: async () => {}
        },
        asRelativePath: (p) => (typeof p === 'string' ? p : p.fsPath || 'file.ts')
      },
      Uri: {
        file: (path) => ({ fsPath: path, scheme: 'file' }),
        joinPath: (base, ...segments) => ({
          fsPath: [base.fsPath || base, ...segments].join('/').replace(/\\/g, '/'),
          scheme: 'file'
        })
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { ToolCallParser } = require('../dist/agent/toolCallParser.js');
const { validateRelativeWorkspacePath } = require('../dist/agent/workspaceTools.js');
const { isWebviewMessage } = require('../dist/ui/webviewMessages.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { computeContentHash } = require('../dist/editing/patchService.js');
const { createUnifiedDiff } = require('../dist/editing/diffService.js');
const { TerminalManager } = require('../dist/terminal/terminalManager.js');
const { AgentLoop } = require('../dist/agent/agentLoop.js');
const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { routeModelWithReason } = require('../dist/providers/modelRouter.js');

test('High-Volume Stress: 1,000 valid tool-call parser inputs across all formats', () => {
  const allowedTools = new Set(['read_workspace_file', 'write_workspace_file', 'search_workspace', 'run_command']);
  let parsedSuccessCount = 0;

  for (let i = 0; i < 1000; i++) {
    const formatType = i % 5;
    let input = '';
    let nativeCalls;

    if (formatType === 0) {
      // Native function call
      nativeCalls = [
        {
          id: `call-${i}`,
          type: 'function',
          function: {
            name: 'read_workspace_file',
            arguments: JSON.stringify({ path: `src/file_${i}.ts` })
          }
        }
      ];
      input = `I am checking step ${i}`;
    } else if (formatType === 1) {
      // <tool_call> XML syntax
      input = `Inspecting file ${i}\n<tool_call>{"name":"search_workspace","arguments":{"query":"keyword_${i}"}}</tool_call>\nEnd of thought`;
    } else if (formatType === 2) {
      // Fenced JSON
      input = '```json\n{"name":"run_command","arguments":{"command":"npm test -- -t run_' + i + '"}}\n```';
    } else if (formatType === 3) {
      // LOCALFORGE_TOOL_CALL protocol
      input = `LOCALFORGE_TOOL_CALL\n{"tool":"write_workspace_file","args":{"path":"dist/bundle_${i}.js","content":"console.log(${i});"}}`;
    } else {
      // Direct raw JSON object
      input = `Analysis complete:\n{"name":"read_workspace_file","arguments":{"path":"config_${i}.json"}}`;
    }

    const result = ToolCallParser.parse(input, nativeCalls, allowedTools);
    assert.equal(result.hadToolCallSyntax, true, `Input #${i} should have detected tool call syntax`);
    assert.ok(result.toolCalls.length >= 1, `Input #${i} should have parsed at least 1 tool call`);
    // Rule 7 & 60: User visible text must NEVER leak raw tool call JSON payloads
    assert.ok(!result.userVisibleText.includes('LOCALFORGE_TOOL_CALL'));
    assert.ok(!result.userVisibleText.includes('<tool_call>'));
    assert.ok(!result.userVisibleText.includes('{"name":'));
    assert.ok(!result.userVisibleText.includes('{"tool":'));
    parsedSuccessCount++;
  }

  assert.equal(parsedSuccessCount, 1000);
});

test('High-Volume Stress: 1,000 malformed tool-call inputs recover cleanly without crash', () => {
  const allowedTools = new Set(['read_workspace_file', 'search_workspace']);
  let cleanRecoveryCount = 0;

  for (let i = 0; i < 1000; i++) {
    const errorType = i % 8;
    let malformedInput = '';

    if (errorType === 0) malformedInput = '<tool_call>{"name":"search_workspace", "arguments": { unclosed';
    else if (errorType === 1) malformedInput = '<tool_call></tool_call>';
    else if (errorType === 2) malformedInput = 'LOCALFORGE_TOOL_CALL\nnot-valid-json';
    else if (errorType === 3) malformedInput = '```json\n{"name": 12345, "arguments": null}\n```';
    else if (errorType === 4) malformedInput = '{"tool": "unknown_tool_xyz", "args": {}}';
    else if (errorType === 5) malformedInput = '<tool_call>{"name": null}</tool_call>';
    else if (errorType === 6) malformedInput = '```json\n{"name": "read_workspace_file", "arguments": "invalid-string-args"}\n```';
    else malformedInput = '{"tool": "read_workspace_file", "args": {"path": null}}';

    // Must never throw an unhandled exception
    assert.doesNotThrow(() => {
      const parsed = ToolCallParser.parse(malformedInput, undefined, allowedTools);
      assert.ok(typeof parsed.userVisibleText === 'string');
      assert.ok(Array.isArray(parsed.toolCalls));
    });
    cleanRecoveryCount++;
  }

  assert.equal(cleanRecoveryCount, 1000);
});

test('High-Volume Stress: 1,000 path validation security cases', () => {
  let validTested = 0;
  let invalidBlocked = 0;

  for (let i = 0; i < 1000; i++) {
    if (i % 2 === 0) {
      // Safe relative paths
      const safePath = `src/module_${i}/sub_${i % 10}/file_${i}.ts`;
      const segments = validateRelativeWorkspacePath(safePath);
      assert.ok(segments.length >= 3);
      validTested++;
    } else {
      // Malicious or invalid paths
      const attackType = (i >> 1) % 6;
      let maliciousPath = '';
      if (attackType === 0) maliciousPath = `../../etc/passwd_${i}`;
      else if (attackType === 1) maliciousPath = `C:\\Windows\\System32\\cmd_${i}.exe`;
      else if (attackType === 2) maliciousPath = `/usr/bin/secret_${i}`;
      else if (attackType === 3) maliciousPath = `src/../..//escape_${i}.js`;
      else if (attackType === 4) maliciousPath = '';
      else maliciousPath = '   ';

      assert.throws(() => validateRelativeWorkspacePath(maliciousPath));
      invalidBlocked++;
    }
  }

  assert.equal(validTested, 500);
  assert.equal(invalidBlocked, 500);
});

test('High-Volume Stress: 1,000 webview message contract validations', () => {
  let validCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < 1000; i++) {
    if (i % 2 === 0) {
      // Valid message
      const typeIdx = (i >> 1) % 6;
      let validMsg;
      if (typeIdx === 0) validMsg = { type: 'ready' };
      else if (typeIdx === 1) validMsg = { type: 'selectModel', model: `ollama:model_${i}` };
      else if (typeIdx === 2) validMsg = { type: 'setMode', mode: (['ask', 'plan', 'agent'])[i % 3] };
      else if (typeIdx === 3) validMsg = { type: 'setStrategy', strategy: i % 2 === 0 ? 'fast' : 'planning' };
      else if (typeIdx === 4) validMsg = { type: 'applyEdit', proposalId: `prop-${i}` };
      else validMsg = { type: 'chat', model: 'qwen', prompt: `Hello query ${i}`, includeContext: true, includeWorkspace: true, agentMode: true };

      assert.equal(isWebviewMessage(validMsg), true, `Should accept valid message #${i}`);
      validCount++;
    } else {
      // Invalid message
      const corruptIdx = (i >> 1) % 6;
      let invalidMsg;
      if (corruptIdx === 0) invalidMsg = null;
      else if (corruptIdx === 1) invalidMsg = [];
      else if (corruptIdx === 2) invalidMsg = { type: 'chat', prompt: 12345 };
      else if (corruptIdx === 3) invalidMsg = { type: 'unknown_action_type' };
      else if (corruptIdx === 4) invalidMsg = { type: 'chat', prompt: 'x'.repeat(25000) }; // oversized
      else invalidMsg = { missing_type_field: true };

      assert.equal(isWebviewMessage(invalidMsg), false, `Should reject invalid message #${i}`);
      rejectedCount++;
    }
  }

  assert.equal(validCount, 500);
  assert.equal(rejectedCount, 500);
});

test('High-Volume Stress: 100 edit proposal content hash and diff calculations', () => {
  for (let i = 0; i < 100; i++) {
    const original = `// Version ${i}\nfunction compute_${i}() {\n  const x = ${i};\n  return x;\n}\n`;
    const modified = `// Version ${i}\nfunction compute_${i}() {\n  // Optimized ${i}\n  return ${i + 1};\n}\n`;

    const originalHash = computeContentHash(original);
    const modifiedHash = computeContentHash(modified);
    assert.equal(originalHash.length, 64);
    assert.equal(modifiedHash.length, 64);
    assert.notEqual(originalHash, modifiedHash);

    const diff = createUnifiedDiff(`src/compute_${i}.ts`, original, modified);
    assert.ok(diff.patch.includes(`--- a/src/compute_${i}.ts`));
    assert.ok(diff.patch.includes(`+++ b/src/compute_${i}.ts`));
    assert.ok(diff.stats.additions >= 1);
    assert.ok(diff.stats.deletions >= 1);
  }
});

test('High-Volume Stress: 100 permission safety and shell operator tests', () => {
  const pm = new PermissionManager('allow_safe_auto');

  for (let i = 0; i < 100; i++) {
    const isChained = i % 2 === 0;
    if (isChained) {
      const op = (['&&', '||', ';', '|', '<', '>', '$()', '`'])[i % 8];
      const chainedCommand = `git status ${op} echo ${i}`;
      assert.equal(
        pm.isSafeCommand(chainedCommand),
        false,
        `Should reject shell operator: ${op}`
      );
    } else {
      const safeCommand = `npm test -- --grep test_${i}`;
      assert.doesNotThrow(() => pm.validateCommandSafety(safeCommand));
      assert.equal(pm.isSafeCommand(safeCommand), false);
    }
  }
});

test('High-Volume Stress: 100 synthetic AgentLoop executions with step boundaries', async () => {
  const toolRegistry = new ToolRegistry();
  toolRegistry.registerTool(
    { type: 'function', function: { name: 'search_workspace', description: 'search', parameters: {} } },
    async (args) => [{ path: 'src/index.ts', content: `result for ${args.query}` }]
  );

  const pm = new PermissionManager('allow_safe_auto');

  for (let i = 0; i < 100; i++) {
    let callCount = 0;
    const fakeProvider = {
      id: 'mock-provider',
      chatWithTools: async () => {
        callCount++;
        if (callCount === 1) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: `c-${i}`, function: { name: 'search_workspace', arguments: `{"query":"item_${i}"}` } }]
          };
        }
        return {
          role: 'assistant',
          content: `Final answer for item ${i}`,
          tool_calls: []
        };
      }
    };

    const loop = new AgentLoop(fakeProvider, toolRegistry, pm);
    const result = await loop.run('mock-model', [{ role: 'user', content: `Find item ${i}` }], {
      maxRounds: 3
    });

    assert.equal(result.state.status, 'completed');
    assert.ok(result.state.steps.length >= 1);
    assert.equal(result.state.steps[0].toolCalls.length, 1);
    assert.equal(result.response, `Final answer for item ${i}`);
  }
});

test('High-Volume Stress: 10 real terminal command executions and status validations', async () => {
  const terminal = new TerminalManager();

  for (let i = 0; i < 10; i++) {
    const message = `LocalForge_Stress_Test_${i}_${Date.now()}`;
    const proc = await terminal.runCommand(
      `node -e "console.log('${message}')"`,
      process.cwd(),
      false,
      10000
    );

    assert.equal(proc.status, 'completed');
    assert.equal(proc.exitCode, 0);
    assert.ok(proc.stdout.includes(message));
    assert.ok(typeof proc.duration === 'number' && proc.duration >= 0);
  }
});

test('High-Volume Stress: Multiple model switching and canonical ID routing tests', () => {
  const models = [
    {
      id: 'ollama:qwen2.5-coder%3A7b',
      name: 'qwen2.5-coder:7b',
      displayName: 'Qwen 7B',
      providerId: 'ollama',
      source: 'local',
      capabilities: { chat: true, toolCalling: true }
    },
    {
      id: 'remote-ssh:qwen2.5-coder%3A32b',
      name: 'qwen2.5-coder:32b',
      displayName: 'Qwen 32B (DGX)',
      providerId: 'remote-ssh',
      source: 'remote',
      capabilities: { chat: true, toolCalling: true }
    },
    {
      id: 'ollama:deepseek-coder%3A6.7b',
      name: 'deepseek-coder:6.7b',
      displayName: 'DeepSeek Coder',
      providerId: 'ollama',
      source: 'local',
      capabilities: { chat: true, codeCompletion: true }
    }
  ];

  for (let i = 0; i < 50; i++) {
    const selected = i % 2 === 0 ? 'remote-ssh:qwen2.5-coder%3A32b' : 'ollama:qwen2.5-coder%3A7b';
    const routed = routeModelWithReason(models, 'agent', {}, selected);
    assert.ok(routed);
    assert.equal(routed.model.id, selected);
    assert.equal(routed.model.source, i % 2 === 0 ? 'remote' : 'local');
  }
});

test('High-Volume Stress: Concurrent cancellation handling in terminal and agent', async () => {
  const terminal = new TerminalManager();

  // Test 5 concurrent cancellations
  const cancelPromises = Array.from({ length: 5 }, async (_, i) => {
    const controller = new AbortController();
    // Launch command that would sleep for 5 seconds
    const runPromise = terminal.runCommand(
      'node -e "setTimeout(() => console.log(\'done\'), 5000)"',
      process.cwd(),
      false,
      30000,
      controller.signal
    );

    // Cancel after 50ms
    setTimeout(() => controller.abort(), 50);
    const proc = await runPromise;
    assert.equal(proc.status, 'stopped');
    assert.ok(proc.stderr.includes('cancelled') || proc.stderr.includes('aborted'));
  });

  await Promise.all(cancelPromises);
});
