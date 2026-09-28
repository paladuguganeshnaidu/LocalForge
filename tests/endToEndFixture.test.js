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
        workspaceFolders: [{ uri: { fsPath: '/test-workspace', scheme: 'file' } }],
        asRelativePath: (uri) => typeof uri === 'string' ? uri : uri.fsPath || '',
        fs: {
          readFile: async () => Buffer.from('const a = 1;'),
          writeFile: async () => {}
        }
      },
      Uri: {
        file: (path) => ({ fsPath: path, scheme: 'file' }),
        joinPath: (base, ...segments) => ({ fsPath: [base.fsPath, ...segments].join('/'), scheme: 'file' }),
        parse: (str) => ({ fsPath: str, scheme: 'localforge-proposed' })
      },
      window: {
        activeTextEditor: undefined,
        showInformationMessage: async () => {},
        showWarningMessage: async () => {},
        showErrorMessage: async () => {}
      },
      languages: {
        getDiagnostics: () => []
      }
    };
  }
  return originalLoad.apply(this, arguments);
};

const { ToolRegistry } = require('../dist/agent/toolRegistry.js');
const { PermissionManager } = require('../dist/agent/permissionManager.js');
const { AgentEngine } = require('../dist/agent/agentEngine.js');
const { ArtifactManager } = require('../dist/core/artifactManager.js');
const { TurnManager } = require('../dist/core/turnManager.js');

test('Product Integration E2E: Full software engineering loop with planning, editing, validation repair, and walkthrough', async () => {
  const toolRegistry = new ToolRegistry();
  const permissionManager = new PermissionManager('allow_safe_auto', async (req) => {
    // Simulated user approval from Review Changes UI
    return true;
  });
  const artifactManager = new ArtifactManager();
  const turnManager = new TurnManager();

  // Register tools
  toolRegistry.registerTool(
    { type: 'function', function: { name: 'search_workspace', description: 'Search', parameters: {} } },
    async (args) => [{ path: 'src/auth.ts', content: 'export function authenticate() {}' }]
  );
  toolRegistry.registerTool(
    { type: 'function', function: { name: 'read_workspace_file', description: 'Read', parameters: {} } },
    async (args) => ({ path: args.path, content: 'export function authenticate() { return false; }' })
  );
  toolRegistry.registerTool(
    { type: 'function', function: { name: 'write_workspace_file', description: 'Write', parameters: {} } },
    async (args) => ({ success: true, path: args.path, bytesWritten: args.content?.length || 0 })
  );

  let step = 0;
  const fakeProvider = {
    id: 'local-test-provider',
    chatWithTools: async (model, messages, tools) => {
      step += 1;
      if (step === 1) {
        // Step 1: Model inspects workspace
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', function: { name: 'search_workspace', arguments: '{"query":"jwt auth"}' } },
            { id: 'call-2', function: { name: 'read_workspace_file', arguments: '{"path":"src/auth.ts"}' } }
          ]
        };
      }
      if (step === 2) {
        // Step 2: Model writes changes
        return {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-3', function: { name: 'write_workspace_file', arguments: '{"path":"src/auth.ts","content":"export function authenticate() { return true; }"}' } }
          ]
        };
      }
      // Step 3: Conclude
      return {
        role: 'assistant',
        content: 'Implemented JWT authentication and verified against workspace requirements.',
        tool_calls: []
      };
    }
  };

  const agentEngine = new AgentEngine(toolRegistry, permissionManager);

  // 1. Start turn
  const turn = turnManager.startTurn({
    conversationId: 'conv-e2e',
    modelId: 'local-test-provider:qwen',
    mode: 'agent',
    strategy: 'planning'
  });

  assert.equal(turn.status, 'running');

  // 2. Planning phase artifact
  const planArtifact = artifactManager.createArtifact({
    type: 'Implementation Plan',
    title: 'Add JWT Authentication',
    content: '## Objective\nAdd auth checks\n## Files\n- src/auth.ts',
    conversationId: 'conv-e2e',
    turnId: turn.turnId
  });
  turnManager.addArtifact(turn.turnId, planArtifact);
  assert.equal(planArtifact.status, 'pending');

  // User proceeds with approved plan
  artifactManager.updateStatus(planArtifact.id, 'approved');
  assert.equal(artifactManager.getArtifact(planArtifact.id)?.status, 'approved');

  // 3. Run agent engine
  const activities = [];
  const result = await agentEngine.runTask(
    fakeProvider,
    'local-test-provider:qwen',
    [{ role: 'user', content: 'Add JWT authentication' }],
    {
      mode: 'agent',
      onToolStart: (name) => {
        activities.push(name);
        turnManager.addActivity(turn.turnId, {
          category: name === 'search_workspace' ? 'Searching' : name === 'read_workspace_file' ? 'Reading' : 'Editing',
          title: `Running ${name}`,
          status: 'success'
        });
      }
    }
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.filesModified.includes('src/auth.ts'));
  assert.equal(activities.length, 3);
  assert.deepEqual(activities, ['search_workspace', 'read_workspace_file', 'write_workspace_file']);

  // 4. Generate Walkthrough artifact on completion
  const walkthrough = artifactManager.createWalkthrough({
    summary: 'JWT authentication implemented in src/auth.ts',
    filesChanged: result.filesModified,
    testsRun: '1 test run',
    validationResult: 'Passed',
    conversationId: 'conv-e2e',
    turnId: turn.turnId
  });
  turnManager.addArtifact(turn.turnId, walkthrough);

  turnManager.completeTurn(turn.turnId, 'completed', result.filesModified);

  const completedTurn = turnManager.getTurn(turn.turnId);
  assert.equal(completedTurn?.status, 'completed');
  assert.equal(completedTurn?.artifacts.length, 2);
  assert.equal(completedTurn?.artifacts[0].type, 'Implementation Plan');
  assert.equal(completedTurn?.artifacts[1].type, 'Walkthrough');
  assert.equal(completedTurn?.filesChanged.length, 1);
});
