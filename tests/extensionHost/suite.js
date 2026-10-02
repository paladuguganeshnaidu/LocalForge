const assert = require('assert');
const vscode = require('vscode');

let completedStages = 0;

async function runStage(stageName, fn) {
  const start = Date.now();
  console.log(`[ExtensionHost] >>> Running stage: ${stageName}`);
  try {
    await fn();
    completedStages += 1;
    console.log(`[ExtensionHost] PASS: ${stageName} (${Date.now() - start}ms)`);
  } catch (err) {
    console.error(`[ExtensionHost] FAIL in stage "${stageName}":`, err);
    throw err;
  }
}

async function run() {
  console.log('=====================================================');
  console.log('  LOMVREN Extension Host Verification Suite');
  console.log('=====================================================');

  let ext;
  let messageHandler;
  let autoApprovePath;
  let autoApproveCommand;
  let autoApproveSessionCommand;
  const permissionRequests = [];

  // Stage 1: Extension Discovery & Activation
  await runStage('Stage 1: Extension Activation', async () => {
    ext = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
    assert.ok(ext, 'Extension paladuguganeshnaidu.localforge-vscode must be discovered');

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, 'Extension must be active');
  });

  // Stage 2: Command Registration
  const expectedCommands = [
    'localforge.openAgent',
    'localforge.newConversation',
    'localforge.continueTask',
    'localforge.reviewChanges',
    'localforge.showArtifacts',
    'localforge.diagnose',
    'localforge.doctor',
    'localforge.selfTest',
    'localforge.refreshModels',
    'localforge.connectRemote',
    'localforge.disconnectRemote',
    'localforge.remoteGpuStatus',
    'localforge.reindexWorkspace',
    'localforge.cancelAgent',
    'localforge.setAgentMode',
    'localforge.setModel'
  ];

  await runStage('Stage 2: Command Registration Verification', async () => {
    const registeredCommands = await vscode.commands.getCommands(true);
    for (const cmd of expectedCommands) {
      assert.ok(
        registeredCommands.includes(cmd),
        `Command "${cmd}" must be registered in the extension host.`
      );
    }
    const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'localforge-vscode');
    assert.ok(extension, 'The LocalForge extension must be present in the host.');
    const contributedViews = extension.packageJSON.contributes?.views?.['localforge-secondary'] || [];
    assert.ok(contributedViews.some((view) => view.id === 'localforge.modelsView'), 'The dedicated Models view must be contributed.');
  });

  // Stage 3: Built-in Command Executions
  await runStage('Stage 3A: localforge.diagnose execution', async () => {
    await vscode.commands.executeCommand('localforge.diagnose');
  });

  await runStage('Stage 3B: localforge.doctor execution', async () => {
    await vscode.commands.executeCommand('localforge.doctor');
  });

  await runStage('Stage 3C: localforge.selfTest execution', async () => {
    await vscode.commands.executeCommand('localforge.selfTest');
  });

  // Stage 4: Agent Mode Switching
  await runStage('Stage 4: Agent Mode Switching (Ask / Plan / Agent)', async () => {
    await vscode.commands.executeCommand('localforge.setAgentMode', 'ask');
    await vscode.commands.executeCommand('localforge.setAgentMode', 'plan');
    await vscode.commands.executeCommand('localforge.setAgentMode', 'agent');
  });

  // Stage 5: Managed Terminal Execution
  await runStage('Stage 5: Managed Terminal Execution', async () => {
    const { TerminalManager } = require('../../dist/terminal/terminalManager.js');
    const terminal = new TerminalManager();
    const proc = await terminal.runCommand('node -e "console.log(\'ExtensionHostTerminalOK\')"', process.cwd(), false, 10000);
    assert.strictEqual(proc.status, 'completed');
    assert.ok(proc.stdout.includes('ExtensionHostTerminalOK'));
  });

  // Stage 6: Workspace Filesystem Operations
  await runStage('Stage 6: Real Workspace File Operations', async () => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(process.cwd());
    const testFileUri = vscode.Uri.joinPath(workspaceRoot, '.localforge_host_test.txt');
    await vscode.workspace.fs.writeFile(testFileUri, Buffer.from('ExtensionHostFsVerified\n', 'utf8'));
    const content = await vscode.workspace.fs.readFile(testFileUri);
    assert.ok(Buffer.from(content).toString('utf8').includes('ExtensionHostFsVerified'));
    await vscode.workspace.fs.delete(testFileUri);
  });

  // Stage 7: Cooperative Cancellation
  await runStage('Stage 7: Cancellation Command Verification', async () => {
    await vscode.commands.executeCommand('localforge.cancelAgent');
  });

  // Stage 8: Webview LifeCycle & IPC Message Flow
  await runStage('Stage 8: Webview LifeCycle and IPC Flow', async () => {
    const api = ext.exports;
    assert.ok(api, 'Extension must export API');
    assert.ok(api.engine, 'Extension API must expose engine');
    assert.ok(api.viewProvider, 'Extension API must expose viewProvider');

    const webviewEvents = [];
    const mockWebview = {
      options: {},
      html: '',
      cspSource: 'https://*.vscode-cdn.net',
      asWebviewUri: (uri) => uri,
      postMessage: async (msg) => {
        webviewEvents.push(msg);
        if (msg.type === 'permissionRequest' && (autoApprovePath || autoApproveCommand || autoApproveSessionCommand)) {
          const request = msg.request;
          console.log(`[ExtensionHost] Permission bridge received ${request.toolName}`);
          permissionRequests.push(request);
          const approved = (request.toolName === 'write_workspace_file' && request.path === autoApprovePath) ||
            (request.toolName === 'run_command' && request.command === autoApproveCommand);
          const approvedForSession = request.toolName === 'run_command' && request.command === autoApproveSessionCommand;
          queueMicrotask(() => void messageHandler({
            type: 'permissionResolved',
            requestId: request.id,
            decision: approvedForSession ? 'allow_session' : approved ? 'allow' : 'deny'
          }));
        }
      },
      onDidReceiveMessage: (handler) => {
        messageHandler = handler;
        return { dispose: () => {} };
      }
    };

    api.viewProvider.resolveWebviewView({ webview: mockWebview });
    assert.ok(typeof messageHandler === 'function', 'Webview view must attach onDidReceiveMessage handler');

    await messageHandler({ type: 'ready' });
    assert.ok(webviewEvents.some((e) => e.type === 'models'), 'Webview should receive models on ready');
    assert.ok(webviewEvents.some((e) => e.type === 'permissionMode'), 'Webview should receive the active permission mode');
    assert.ok(mockWebview.html.includes('permissionModeSelect'), 'Settings should expose the approval-mode selector');
    assert.ok(mockWebview.html.includes('Model tool input'), 'Activity details should expose exact model tool inputs');
    assert.ok(mockWebview.html.includes('Tool output'), 'Activity details should expose bounded tool outputs');

    const sessionId = api.engine.sessionManager.getActiveSession().id;
    const traceTurn = api.engine.turnManager.startTurn({
      conversationId: sessionId,
      modelId: 'test-model',
      mode: 'agent',
      strategy: 'fast'
    });
    api.engine.turnManager.addActivity(traceTurn.turnId, {
      category: 'Running',
      title: 'Persisted trace probe',
      status: 'success',
      inputSummary: 'safe test input',
      outputSummary: 'safe test output'
    });
    api.engine.turnManager.completeTurn(traceTurn.turnId, 'completed');
    await messageHandler({ type: 'ready' });
    const traceMessage = webviewEvents.filter((event) => event.type === 'activityHistory').at(-1);
    assert.ok(traceMessage?.activities.some((activity) => activity.title === 'Persisted trace probe'), 'Reopening chat should receive the active conversation trace');

    await messageHandler({ type: 'setPermissionMode', mode: 'always_ask' });
    assert.strictEqual(api.engine.permissionManager.getMode(), 'always_ask', 'Approval-mode selection should update the engine');
    const originalPermissionMode = api.engine.permissionManager.getMode();
    const approvalTurn = api.engine.turnManager.startTurn({
      conversationId: sessionId,
      modelId: 'approval-test-model',
      mode: 'agent',
      strategy: 'fast'
    });
    try {
      api.engine.permissionManager.setMode('always_ask');
      autoApproveCommand = 'echo LOCALFORGE_TIMELINE_APPROVED';
      permissionRequests.length = 0;
      const approved = await api.engine.permissionManager.checkPermission('run_command', {
        command: autoApproveCommand
      });
      assert.equal(approved, true, 'The approval bridge should return the user decision to the tool');

      const deniedCommand = 'echo LOCALFORGE_TIMELINE_DENIED';
      const denied = await api.engine.permissionManager.checkPermission('run_command', {
        command: deniedCommand
      });
      assert.equal(denied, false, `The approval bridge should deny a rejected command; approvals: ${JSON.stringify(permissionRequests)}`);

      autoApproveSessionCommand = 'echo LOCALFORGE_TIMELINE_SESSION';
      const approvedForSession = await api.engine.permissionManager.checkPermission('run_command', {
        command: autoApproveSessionCommand
      });
      assert.equal(approvedForSession, true, 'The approval bridge should honor the session approval choice');
      assert.equal(api.engine.permissionManager.getMode(), 'ask_once_per_session');

      const approvals = api.engine.getActivityHistory(sessionId)
        .filter((activity) => activity.inputSummary?.includes('LOCALFORGE_TIMELINE_'));
      assert.ok(approvals.some((activity) => activity.title.startsWith('Approved for this action:') && activity.status === 'success'),
        'An approved action should remain in the persisted activity history');
      assert.ok(approvals.some((activity) => activity.title.startsWith('Denied by user:') && activity.status === 'warning'),
        'A denied action should remain in the persisted activity history');
      assert.ok(approvals.some((activity) => activity.title.startsWith('Approved for this session:') && activity.status === 'success'),
        'A session approval should remain in the persisted activity history');
      assert.ok(approvals.every((activity) => activity.inputSummary.includes('LOCALFORGE_TIMELINE_')),
        'The redacted command input should be inspectable on the timeline');
      assert.ok(webviewEvents.filter((event) => event.type === 'activity')
        .some((event) => event.activity.title.startsWith('Denied by user:')),
      'The updated approval decision should be sent to the visible timeline');
    } finally {
      autoApproveCommand = undefined;
      autoApproveSessionCommand = undefined;
      api.engine.permissionManager.setMode(originalPermissionMode);
      api.engine.turnManager.completeTurn(approvalTurn.turnId, 'completed');
    }

    const originalExecuteTask = api.engine.executeTask;
    const previousMode = api.viewProvider.activeMode;
    try {
      api.engine.executeTask = async (prompt, mode, model, callbacks) => {
        assert.equal(prompt, 'test prompt from extension host');
        assert.equal(mode, 'ask', 'The IPC chat probe must use read-only Ask mode');
        callbacks.onToken('LOCALFORGE_IPC_OK');
        return { response: 'LOCALFORGE_IPC_OK', errors: [] };
      };
      await messageHandler({ type: 'setMode', mode: 'ask' });
      await messageHandler({
        type: 'chat',
        model: 'auto',
        prompt: 'test prompt from extension host',
        includeContext: true,
        includeWorkspace: true,
        agentMode: false
      });
      assert.ok(webviewEvents.some((event) => event.type === 'chunk' && event.content === 'LOCALFORGE_IPC_OK'),
        'Runtime token callbacks should be sent to the webview');
      assert.ok(webviewEvents.some((event) => event.type === 'done' && event.fullResponse === 'LOCALFORGE_IPC_OK'),
        'The completed runtime response should be sent to the webview');
    } finally {
      api.engine.executeTask = originalExecuteTask;
      api.viewProvider.activeMode = previousMode;
    }
  });

  if (process.env.LOCALFORGE_REAL_OLLAMA_EDIT === '1') {
    await runStage('Stage 9: Live Ollama file proposal and approval', async () => {
      const api = ext.exports;
      const requestedModel = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
      await api.engine.bootstrap();
      const model = api.engine.modelRegistry.getModels().find((candidate) => candidate.name === requestedModel);
      assert.ok(model, `Ollama model ${requestedModel} must be installed for the live edit test`);

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      assert.ok(workspaceRoot, 'An open workspace is required for the live edit test');
      const relativeDirectory = `.localforge-live-edit-${Date.now()}`;
      const relativePath = `${relativeDirectory}/result.txt`;
      const directoryUri = vscode.Uri.joinPath(workspaceRoot, relativeDirectory);
      const fileUri = vscode.Uri.joinPath(workspaceRoot, relativePath);
      const expectedMarker = 'LOCALFORGE_REVIEWED_EDIT_OK';
      const originalMode = api.engine.permissionManager.getMode();
      const toolCalls = [];

      await vscode.workspace.fs.createDirectory(directoryUri);
      autoApprovePath = relativePath;
      permissionRequests.length = 0;
      api.engine.permissionManager.setMode('always_ask');
      try {
        const { AgentLoop } = require('../../dist/agent/agentLoop.js');
        const { ToolRegistry } = require('../../dist/agent/toolRegistry.js');
        const { allWorkspaceTools, executeWorkspaceTool } = require('../../dist/agent/workspaceTools.js');
        const writeDefinition = allWorkspaceTools.find((tool) => tool.function.name === 'write_workspace_file');
        assert.ok(writeDefinition, 'The built-in write tool definition must exist');
        const isolatedRegistry = new ToolRegistry();
        isolatedRegistry.registerTool(writeDefinition, (args) => executeWorkspaceTool('write_workspace_file', args, {
          editEngine: api.engine.editEngine,
          terminalManager: api.engine.terminalManager,
          conversationId: 'live-ollama-edit-test',
          autoApply: false
        }), 'edit');

        const result = await new AgentLoop(api.engine.compositeProvider, isolatedRegistry, api.engine.permissionManager).run(
          model.id,
          [{
            role: 'user',
            content: `For this isolated extension-host test, call write_workspace_file exactly once to create the workspace-relative file "${relativePath}" with the exact content "${expectedMarker}". Do not run commands or edit any other file.`
          }],
          {
            mode: 'agent',
            maxRounds: 4,
            onToolStart: (name, args) => {
              toolCalls.push({ name, args });
              console.log(`[LiveEdit] Model requested ${name} for ${args.path || args.target_path || args.relative_path || 'unknown path'}`);
            }
          }
        );

        assert.equal(result.state.status, 'completed', `Agent run failed: ${result.response}; errors: ${JSON.stringify(result.state.unresolvedErrors)}; tool calls: ${JSON.stringify(toolCalls)}; approvals: ${JSON.stringify(permissionRequests)}`);
        assert.ok(toolCalls.length >= 1, `The model must request the file-write tool; response: ${result.response}`);
        assert.ok(toolCalls.every((call) => call.name === 'write_workspace_file' && call.args.path === relativePath),
          `Every file-write request must stay scoped to the exact test path: ${JSON.stringify(toolCalls)}`);
        assert.equal(permissionRequests.length, 1, 'The new-file edit must ask for permission exactly once');
        assert.equal(permissionRequests[0].toolName, 'write_workspace_file');
        assert.equal(permissionRequests[0].path, relativePath);

        const proposal = api.engine.editEngine.getPendingProposals()
          .find((candidate) => candidate.files.some((file) => file.path === relativePath));
        assert.ok(proposal, 'The model edit must become a pending review proposal');
        assert.equal(proposal.status, 'pending');
        await assert.rejects(vscode.workspace.fs.readFile(fileUri));

        const accepted = await api.engine.editEngine.applyProposal(proposal.id);
        assert.equal(accepted.success, true, 'Accepting the reviewed proposal should apply it');
        const written = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
        assert.ok(written.includes(expectedMarker), `The accepted file should contain the requested model-generated content; actual content: ${JSON.stringify(written)}; proposal: ${JSON.stringify(proposal.files[0].newContent)}; agent response: ${result.response}`);
      } finally {
        autoApprovePath = undefined;
        api.engine.permissionManager.setMode(originalMode);
        await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false }).catch(() => {});
      }
    });

    await runStage('Stage 10: Live Ollama command approval and terminal output', async () => {
      const api = ext.exports;
      const requestedModel = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
      await api.engine.bootstrap();
      const model = api.engine.modelRegistry.getModels().find((candidate) => candidate.name === requestedModel);
      assert.ok(model, `Ollama model ${requestedModel} must be installed for the live command test`);

      const command = 'echo LOCALFORGE_COMMAND_APPROVAL_OK';
      const originalMode = api.engine.permissionManager.getMode();
      const toolCalls = [];
      autoApproveCommand = command;
      permissionRequests.length = 0;
      api.engine.permissionManager.setMode('always_ask');
      try {
        const { AgentLoop } = require('../../dist/agent/agentLoop.js');
        const { ToolRegistry } = require('../../dist/agent/toolRegistry.js');
        const { allWorkspaceTools, executeWorkspaceTool } = require('../../dist/agent/workspaceTools.js');
        const commandDefinition = allWorkspaceTools.find((tool) => tool.function.name === 'run_command');
        assert.ok(commandDefinition, 'The built-in command tool definition must exist');
        const isolatedRegistry = new ToolRegistry();
        isolatedRegistry.registerTool(commandDefinition, (args) => executeWorkspaceTool('run_command', args, {
          terminalManager: api.engine.terminalManager
        }), { category: 'execute', riskLevel: 'low_risk', requiresApproval: true });

        const result = await new AgentLoop(api.engine.compositeProvider, isolatedRegistry, api.engine.permissionManager).run(
          model.id,
          [{
            role: 'user',
            content: `For this isolated extension-host test, call run_command exactly once with the exact harmless command "${command}". Do not run any other command. After it succeeds, report its output.`
          }],
          {
            mode: 'agent',
            maxRounds: 4,
            onToolStart: (name, args) => {
              toolCalls.push({ name, args });
              console.log(`[LiveCommand] Model requested ${name}`);
            }
          }
        );

        assert.equal(result.state.status, 'completed', `Agent run failed: ${result.response}; errors: ${JSON.stringify(result.state.unresolvedErrors)}; calls: ${JSON.stringify(toolCalls)}; approvals: ${JSON.stringify(permissionRequests)}`);
        assert.ok(toolCalls.length >= 1, `The model must request the command; calls: ${JSON.stringify(toolCalls)}; response: ${result.response}`);
        assert.ok(toolCalls.every((call) => call.name === 'run_command' && call.args.command === command),
          `Every command request must match the exact approved command: ${JSON.stringify(toolCalls)}`);
        assert.equal(permissionRequests.length, 1, 'The command must ask for explicit approval exactly once');
        assert.equal(permissionRequests[0].toolName, 'run_command');
        assert.equal(permissionRequests[0].command, command);
        const toolResult = result.state.steps.flatMap((step) => step.toolCalls).find((call) => call.name === 'run_command')?.result;
        assert.equal(toolResult?.exitCode, 0, 'The approved command should complete successfully');
        assert.match(toolResult?.stdout || '', /LOCALFORGE_COMMAND_APPROVAL_OK/);
      } finally {
        autoApproveCommand = undefined;
        api.engine.permissionManager.setMode(originalMode);
      }
    });
  }

  await runStage('Models view activation', async () => {
    await vscode.commands.executeCommand('localforge.modelsView.focus');
  });

  console.log('=====================================================');
  console.log(`  ALL ${completedStages} EXTENSION HOST INTEGRATION STAGES PASSED`);
  console.log('=====================================================');
}

module.exports = { run };
