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
  const webviewEvents = [];
  const activeEngineExecutions = new Map();

  // Stage 1: Extension Discovery & Activation
  await runStage('Stage 1: Extension Activation', async () => {
    ext = vscode.extensions.getExtension('paladuguganeshnaidu.tuxnest-vscode') || vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
    assert.ok(ext, 'Extension paladuguganeshnaidu.tuxnest-vscode must be discovered');

    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true, 'Extension must be active');
    for (const name of ['executeTask', 'applyProposalAndValidate', 'rollbackRecordedChanges']) {
      const original = ext.exports.engine[name];
      ext.exports.engine[name] = async function (...args) {
        const invocation = Symbol(name);
        activeEngineExecutions.set(invocation, { name, args: args.slice(0, 3), caller: new Error('Engine invocation').stack });
        try { return await original.apply(this, args); }
        finally { activeEngineExecutions.delete(invocation); }
      };
    }
  });

  // Stage 2: Command Registration
  const expectedCommands = [
    'tuxnest.openAgent',
    'tuxnest.newConversation',
    'tuxnest.continueTask',
    'tuxnest.reviewChanges',
    'tuxnest.showArtifacts',
    'tuxnest.diagnose',
    'tuxnest.doctor',
    'tuxnest.selfTest',
    'tuxnest.refreshModels',
    'tuxnest.connectRemote',
    'tuxnest.disconnectRemote',
    'tuxnest.remoteGpuStatus',
    'tuxnest.reindexWorkspace',
    'tuxnest.cancelAgent',
    'tuxnest.setAgentMode',
    'tuxnest.setModel'
  ];

  await runStage('Stage 2: Command Registration Verification', async () => {
    const registeredCommands = await vscode.commands.getCommands(true);
    for (const cmd of expectedCommands) {
      assert.ok(
        registeredCommands.includes(cmd),
        `Command "${cmd}" must be registered in the extension host.`
      );
    }
    const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'tuxnest-vscode' || item.packageJSON?.name === 'localforge-vscode');
    assert.ok(extension, 'The TuxNest extension must be present in the host.');
    const views = extension.packageJSON.contributes?.views || {};
    const contributedViews = views['tuxnest-secondary'] || views['localforge-secondary'] || [];
    assert.ok(contributedViews.some((view) => view.id === 'tuxnest.modelsView' || view.id === 'localforge.modelsView'), 'The dedicated Models view must be contributed.');
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
    for (const effort of ['low', 'medium', 'high', 'ultra']) {
      await messageHandler({ type: 'setEffort', effort });
      assert.equal(api.engine.sessionManager.getActiveSession().effort, effort);
      assert.ok(webviewEvents.some(event => event.type === 'effort' && event.effort === effort));
    }
    api.viewProvider.busy = true;
    try {
      const before = webviewEvents.length;
      await messageHandler({ type: 'setEffort', effort: 'low' });
      assert.equal(api.engine.sessionManager.getActiveSession().effort, 'ultra');
      assert.ok(webviewEvents.slice(before).some(event => event.type === 'controlError'));
      assert.ok(!webviewEvents.slice(before).some(event => event.type === 'error'));
    } finally { api.viewProvider.busy = false; }
    await messageHandler({ type: 'setEffort', effort: 'medium' });
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
      assert.equal(api.engine.permissionManager.hasWorkspaceSessionApproval(), true);
      const sessionRequests = permissionRequests.length;
      const sessionCommand = await api.engine.toolRegistry.executeTool('run_command', { command: 'echo SESSION_GRANT_ACTUAL_COMMAND' }, api.engine.permissionManager);
      assert.equal(sessionCommand.exitCode, 0);
      assert.match(sessionCommand.stdout, /SESSION_GRANT_ACTUAL_COMMAND/);
      const sessionFile = await api.engine.toolRegistry.executeTool('create_file', { path: 'session-approval-probe.md', content: '# Real session-approved saved file\n' }, api.engine.permissionManager);
      assert.equal(sessionFile.applied, true);
      const sessionBytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'session-approval-probe.md'));
      assert.equal(new TextDecoder().decode(sessionBytes), '# Real session-approved saved file\n');
      assert.equal(permissionRequests.length, sessionRequests, 'The session grant must cover a new ordinary command and new saved edit without more prompts');

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
      autoApproveCommand = undefined;
      autoApproveSessionCommand = undefined;
      api.engine.permissionManager.setMode('always_ask');
      const approvalController = new AbortController();
      const cancelledApproval = api.engine.permissionManager.checkPermission('run_command', {
        command: 'echo LOCALFORGE_CANCELLED_APPROVAL'
      }, false, approvalController.signal);
      const cancelledRequest = webviewEvents.filter((event) => event.type === 'permissionRequest').at(-1).request;
      await messageHandler({ type: 'ready' });
      assert.ok(webviewEvents.filter((event) => event.type === 'permissionRequest' && event.request.id === cancelledRequest.id).length >= 2,
        'Pending approvals should be replayed when the view reloads');
      approvalController.abort();
      await assert.rejects(cancelledApproval, (error) => error.name === 'AbortError');
      assert.ok(webviewEvents.some((event) => event.type === 'permissionCancelled' && event.requestId === cancelledRequest.id),
        'Cancellation should remove the pending approval card');
      await messageHandler({ type: 'permissionResolved', requestId: cancelledRequest.id, decision: 'allow_session' });
      assert.equal(api.engine.permissionManager.getMode(), 'always_ask', 'A stale approval must not grant session permissions');
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

  await runStage('Canonical tool policy, explicit process approval and real controlled command execution', async () => {
    const engine = ext.exports.engine;
    const root = vscode.workspace.workspaceFolders[0].uri;
    const script = vscode.Uri.joinPath(root, 'policy-approval-test.cjs');
    const marker = vscode.Uri.joinPath(root, 'policy-command-marker.txt');
    const command = 'node "' + script.fsPath + '"';
    const previousMode = engine.permissionManager.getMode();
    const previousCommand = autoApproveCommand;
    const before = permissionRequests.length;
    engine.toolRegistry.assertInvariants();
    for (const name of ['list_directory', 'run_command']) assert.equal(engine.toolRegistry.getAllTools().filter((tool) => tool.name === name).length, 1);
    await vscode.workspace.fs.writeFile(script, Buffer.from('require("node:fs").writeFileSync("policy-command-marker.txt", "NATIVE_APPROVAL_PASS"); console.log("NATIVE_APPROVAL_PASS");'));
    engine.permissionManager.setMode('always_proceed');
    try {
      autoApproveCommand = 'DENY_UNMATCHED_CONTROLLED_COMMAND';
      await assert.rejects(engine.toolRegistry.executeTool('run_command', { command }, engine.permissionManager), /rejected/);
      await assert.rejects(vscode.workspace.fs.stat(marker), /not found|ENOENT/i);
      autoApproveCommand = command;
      const result = await engine.toolRegistry.executeTool('run_command', { command }, engine.permissionManager);
      assert.equal(result.exitCode, 0, JSON.stringify(result));
      assert.match(result.stdout, /NATIVE_APPROVAL_PASS/);
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(marker)).toString(), 'NATIVE_APPROVAL_PASS');
      assert.equal(permissionRequests.length - before, 2);
      for (const request of permissionRequests.slice(before)) {
        assert.equal(request.command, command);
        assert.equal(request.category, 'execute');
        assert.equal(request.policy.approval, 'explicit');
        assert.equal(request.policy.processExecution, true);
      }
      const scoped = engine.toolRegistry.createScopedRegistry(['execute']);
      assert.strictEqual(scoped.getTool('run_command'), engine.toolRegistry.getTool('run_command'));
      console.log('[ToolPolicyNative] Unique registry, serialized canonical approval metadata, denied no-side-effect command and explicitly approved real process verified.');
    } finally {
      engine.permissionManager.setMode(previousMode);
      autoApproveCommand = previousCommand;
      for (const target of [script, marker]) { try { await vscode.workspace.fs.delete(target); } catch (error) { if (error.code !== 'FileNotFound') throw error; } }
    }
  });

  await runStage('Configured endpoints: real HTTP, settings IPC, exact routing, safe deferral and unavailable selection', async () => {
    const http = require('node:http');
    const { compatibleProviderId } = require('../../dist/providers/endpointConfiguration');
    const engine = ext.exports.engine;
    const compatible = vscode.workspace.getConfiguration('localforge.providers');
    const previous = compatible.inspect('openAICompatibleUrls').globalValue;
    const previousSession = engine.sessionManager.getActiveSession().id;
    const servers = [];
    const endpoints = [];
    const states = [];
    try {
      for (const label of ['ENDPOINT_A', 'ENDPOINT_B']) {
        const state = { healthy: true, calls: 0, hold: false, entered: undefined, release: undefined };
        const server = http.createServer((request, response) => {
          if (!state.healthy) { response.writeHead(503).end('Fixture unavailable'); return; }
          if (request.url === '/v1/models') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'shared:model/v1' }] })); return; }
          let body = '';
          request.on('data', (chunk) => { body += chunk; });
          request.on('end', () => {
            const input = JSON.parse(body);
            assert.equal(input.model, 'shared:model/v1');
            state.calls += 1;
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            const finish = () => response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: label } }] }) + '\n\ndata: [DONE]\n\n');
            if (state.hold) { state.release = finish; state.entered?.(); } else finish();
          });
        });
        servers.push(server); states.push(state);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        endpoints.push('http://127.0.0.1:' + server.address().port + '/v1');
      }
      const ids = endpoints.map(compatibleProviderId);
      const modelIds = ids.map((id) => id + ':shared%3Amodel%2Fv1');
      await messageHandler({ type: 'updateSettings', settings: { 'providers.openAICompatibleUrls': endpoints.join(',') + ',' + endpoints[0] + '/' } });
      assert.equal(vscode.workspace.getConfiguration('localforge.providers').inspect('openAICompatibleUrls').workspaceValue, undefined);
      assert.ok(vscode.workspace.getConfiguration('localforge.providers').inspect('openAICompatibleUrls').globalValue);
      assert.equal(engine.modelRegistry.getAllProviders().filter((provider) => ids.includes(provider.id)).length, 2);
      const retained = engine.modelRegistry.getProvider(ids[1]);
      assert.strictEqual(engine.compositeProvider.getProviders().find((provider) => provider.id === ids[1]), retained);
      await messageHandler({ type: 'newSession' });
      await messageHandler({ type: 'setMode', mode: 'ask' });
      const conversation = engine.sessionManager.getActiveSession().id;
      for (const [index, label] of [[0, 'ENDPOINT_A'], [1, 'ENDPOINT_B']]) {
        await messageHandler({ type: 'selectModel', model: modelIds[index] });
        const offset = webviewEvents.length;
        await messageHandler({ type: 'chat', prompt: 'hello', model: modelIds[index], includeContext: false, includeWorkspace: false, agentMode: false });
        assert.ok(webviewEvents.slice(offset).some((event) => event.type === 'done' && event.fullResponse === label));
        assert.equal(engine.sessionManager.getActiveSession().id, conversation);
      }
      assert.equal(states[0].calls, 1); assert.equal(states[1].calls, 1);
      const originalMessages = engine.sessionManager.getActiveSession().messages.map((message) => message.content);
      for (const health of [[false, true], [true, false], [false, false], [true, true]]) {
        states.forEach((state, index) => { state.healthy = health[index]; });
        await engine.modelRegistry.refresh(); await ext.exports.viewProvider.refresh();
        ids.forEach((id, index) => {
          const report = engine.modelRegistry.getHealthReport().find((entry) => entry.id === id);
          assert.equal(report.isReachable, health[index]); assert.equal(report.modelCount, health[index] ? 1 : 0);
        });
        assert.deepEqual(engine.sessionManager.getActiveSession().messages.map((message) => message.content), originalMessages);
      }
      assert.equal(engine.compositeProvider.resolveProvider('shared:model/v1'), undefined);
      states[1].hold = true;
      const entered = new Promise((resolve) => { states[1].entered = resolve; });
      const running = engine.executeTask('hello', 'ask', modelIds[1]);
      await entered;
      await messageHandler({ type: 'updateSettings', settings: { 'providers.openAICompatibleUrls': endpoints[0] } });
      assert.equal(engine.getProviderConfigurationStatus().pending, true);
      assert.strictEqual(engine.modelRegistry.getProvider(ids[1]), retained);
      states[1].release();
      assert.equal((await running).response, 'ENDPOINT_B');
      assert.equal(engine.getProviderConfigurationStatus().pending, false);
      assert.equal(engine.modelRegistry.getProvider(ids[1]), undefined);
      assert.equal(engine.compositeProvider.resolveProvider(modelIds[1]), undefined);
      const callsBefore = states.map((state) => state.calls);
      const offset = webviewEvents.length;
      await messageHandler({ type: 'chat', prompt: 'hello', model: modelIds[1], includeContext: false, includeWorkspace: false, agentMode: false });
      assert.ok(webviewEvents.slice(offset).some((event) => event.type === 'error' && /unavailable/.test(event.message)));
      assert.deepEqual(states.map((state) => state.calls), callsBefore);
      const invalidOffset = webviewEvents.length;
      await messageHandler({ type: 'updateSettings', settings: { 'providers.openAICompatibleUrls': 'https://user:PRIVATE_TOKEN@host/v1' } });
      assert.equal(vscode.workspace.getConfiguration('localforge.providers').get('openAICompatibleUrls'), endpoints[0]);
      assert.ok(webviewEvents.slice(invalidOffset).some((event) => event.type === 'error' && /No settings were saved/.test(event.message)));
      assert.ok(webviewEvents.some((event) => event.type === 'providerStatus' && event.providers?.some((provider) => provider.id === ids[0] && provider.isReachable)));
      console.log('[Endpoints] Actual HTTP transports, duplicate model names, four health states, user-scoped settings, busy-task deferral, stale selection and invalid-setting error verified through real extension IPC.');
    } finally {
      for (const state of states) state.release?.();
      await compatible.update('openAICompatibleUrls', previous, vscode.ConfigurationTarget.Global);
      await engine.updateProviderConfiguration({ ollamaEndpoint: vscode.workspace.getConfiguration('localforge.ollama').get('baseUrl'), openAiEndpoints: vscode.workspace.getConfiguration('localforge.providers').get('openAICompatibleUrls', '') });
      await messageHandler({ type: 'loadSession', sessionId: previousSession });
      for (const server of servers) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    }
  });

  if (process.env.LOCALFORGE_REAL_OLLAMA_EDIT === '1') {
    await runStage('Native reviewed existing-file edits persist to disk', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      assert.ok(root, 'A workspace is required for native edit verification');
      const directoryName = `.localforge-native-edit-${Date.now()}`;
      const directoryUri = vscode.Uri.joinPath(root, directoryName);
      const target = vscode.Uri.joinPath(directoryUri, 'existing.txt');
      await vscode.workspace.fs.createDirectory(directoryUri);
      let recoveryId;
      try {
        await vscode.workspace.fs.writeFile(target, Buffer.from('original'));
        const proposal = await ext.exports.engine.editEngine.proposeEdits(root, [
          { path: `${directoryName}/existing.txt`, newContent: 'reviewed and persisted' }
        ]);
        const result = await ext.exports.engine.editEngine.applyProposal(proposal.id);
        recoveryId = result.recoveryId;
        assert.equal(result.success, true, JSON.stringify(result.errors));
        assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'), 'reviewed and persisted');
      } finally {
        if (recoveryId) await ext.exports.engine.editEngine.forgetRecovery(recoveryId);
        await vscode.workspace.fs.delete(directoryUri, { recursive: true, useTrash: false }).catch(() => {});
      }
    });

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
      let recoveryId;

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
        recoveryId = accepted.recoveryId;
        assert.equal(accepted.success, true, 'Accepting the reviewed proposal should apply it');
        const written = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
        assert.ok(written.includes(expectedMarker), `The accepted file should contain the requested model-generated content; actual content: ${JSON.stringify(written)}; proposal: ${JSON.stringify(proposal.files[0].newContent)}; agent response: ${result.response}`);
      } finally {
        if (recoveryId) await api.engine.editEngine.forgetRecovery(recoveryId);
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

  await runStage('Review-only file creation in real VS Code, even with Always proceed', async () => {
    const engine = ext.exports.engine;
    const root = vscode.workspace.workspaceFolders[0].uri;
    const relativePath = 'agent-edit-test.md';
    const target = vscode.Uri.joinPath(root, relativePath);
    const expectedContent = '# Agent Edit Test\nLOMVREN successfully created this file.\n';
    const originalModels = engine.modelRegistry.getModels;
    const originalChat = engine.compositeProvider.chatWithTools;
    const originalPermissionMode = engine.permissionManager.getMode();
    let requests = 0;
    engine.modelRegistry.getModels = () => [{ id: 'fixture:review-test', name: 'review-test', providerId: 'fixture' }];
    engine.compositeProvider.chatWithTools = async (_model, _messages, tools) => {
      requests += 1;
      assert.ok(!tools.some((tool) => tool.function.name === 'run_command'), 'A single-file preview request must not offer terminal writes');
      return requests % 2 === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'review-create', function: { name: 'write_workspace_file', arguments: JSON.stringify({ path: relativePath, content: expectedContent }) } }] } : { role: 'assistant', content: '## Proposed change\nReview agent-edit-test.md in Changes. The file has not been created yet.' };
    };
    engine.permissionManager.setMode('always_proceed');
    try {
      const result = await engine.executeTask(`Create a file named ${relativePath} in the workspace root containing the test text. Do not modify any other files. If this file already exists, stop and tell me. Show the proposed change for my approval.`, 'agent', 'fixture:review-test');
      assert.equal(result.status, 'waiting_for_approval', result.response);
      assert.deepEqual(result.filesModified, []);
      await assert.rejects(vscode.workspace.fs.stat(target), /not found|ENOENT/i);
      const proposal = engine.editEngine.getPendingProposals().find((candidate) => candidate.files.some((file) => file.path === relativePath));
      assert.ok(proposal, 'Changes must expose a real pending proposal');
      assert.equal(proposal.conversationId, engine.sessionManager.getActiveSession().id);
      assert.ok(proposal.turnId, 'The proposal must belong to the current turn');
      assert.equal(proposal.files[0].operation, 'create');
      assert.equal(proposal.files[0].newContent, expectedContent);
      const applied = await engine.editEngine.applyProposal(proposal.id);
      assert.equal(applied.success, true, JSON.stringify(applied));
      assert.deepEqual(applied.savedFiles, [relativePath]);
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString(), expectedContent);
      const beforeExisting = requests;
      const stopped = await engine.executeTask(`Create a file named ${relativePath}. If this file already exists, stop and tell me. Show the proposed change for my approval.`, 'agent', 'fixture:review-test');
      assert.equal(stopped.status, 'failed');
      assert.match(stopped.response, /already exists.*stopped without changing/s);
      assert.equal(requests, beforeExisting + 1, 'Existing-file refusal must not retry or reread');
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString(), expectedContent);
      console.log('[EditApproval] Pending preview, approved save and existing-file protection verified with real VS Code filesystem/editor APIs. Model and approval decisions are controlled fixtures.');
    } finally {
      engine.modelRegistry.getModels = originalModels;
      engine.compositeProvider.chatWithTools = originalChat;
      engine.permissionManager.setMode(originalPermissionMode);
      try { await vscode.workspace.fs.delete(target); } catch (error) { if (error.code !== 'FileNotFound') throw error; }
    }
  });

  await runStage('Live workspace watcher, deterministic search, edit/rollback and index UI IPC', async () => {
    const engine = ext.exports.engine;
    const root = vscode.workspace.workspaceFolders[0].uri;
    const alpha = vscode.Uri.joinPath(root, 'alpha.txt');
    const moved = vscode.Uri.joinPath(root, 'nested', 'file with spaces.txt');
    const ignored = vscode.Uri.joinPath(root, 'ignored.txt');
    const control = vscode.Uri.joinPath(root, '.gitignore');
    const binary = vscode.Uri.joinPath(root, 'binary.txt');
    const oversized = vscode.Uri.joinPath(root, 'oversized.txt');
    const edited = vscode.Uri.joinPath(root, 'agent-index-edit.txt');
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 10000;
      while (!predicate()) {
        if (Date.now() > deadline) throw new Error('The real filesystem watcher did not converge: ' + JSON.stringify(engine.indexer.getStats()));
        await new Promise((resolve) => setTimeout(resolve, 100));
        await engine.indexer.whenIdle();
      }
    };
    await engine.indexer.ensureReady();
    assert.equal(engine.indexer.getStats().watching, true);
    const originalChat = engine.compositeProvider.chatWithTools;
    engine.compositeProvider.chatWithTools = async () => { throw new Error('Deterministic workspace search must not call a model'); };
    try {
      await vscode.workspace.fs.writeFile(alpha, Buffer.from('Header\nRAG_ALPHA_918273\n'));
      await waitFor(() => engine.indexer.getDocuments().some((document) => document.path === 'alpha.txt'));
      const first = await engine.executeTask('/search RAG_ALPHA_918273', 'ask');
      assert.match(first.response, /alpha.txt:1–3/); assert.match(first.response, /chunk: [a-f0-9]{64}.*SHA-256: [a-f0-9]{64}/);
      const oldHash = engine.indexer.getDocuments().find((document) => document.path === 'alpha.txt').hash;
      await vscode.workspace.fs.writeFile(alpha, Buffer.from('Header\nRAG_ALPHA_CHANGED_192837\n'));
      await waitFor(() => engine.indexer.getDocuments().some((document) => document.path === 'alpha.txt' && document.hash !== oldHash));
      assert.match((await engine.executeTask('/search RAG_ALPHA_918273', 'ask')).response, /No matching indexed/);
      assert.match((await engine.executeTask('/search RAG_ALPHA_CHANGED_192837', 'ask')).response, /RAG_ALPHA_CHANGED_192837/);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root, 'nested'));
      await vscode.workspace.fs.rename(alpha, moved);
      await waitFor(() => !engine.indexer.getDocuments().some((document) => document.path === 'alpha.txt') && engine.indexer.getDocuments().some((document) => document.path === 'nested/file with spaces.txt'));
      assert.match((await engine.executeTask('/search RAG_ALPHA_CHANGED_192837', 'ask')).response, /nested\/file with spaces.txt/);
      await vscode.workspace.fs.delete(moved);
      await waitFor(() => !engine.indexer.getDocuments().some((document) => document.path === 'nested/file with spaces.txt'));
      assert.match((await engine.executeTask('/search RAG_ALPHA_CHANGED_192837', 'ask')).response, /No matching indexed/);
      await vscode.workspace.fs.writeFile(control, Buffer.from('ignored.txt\n'));
      await vscode.workspace.fs.writeFile(ignored, Buffer.from('RAG_IGNORED_TOKEN'));
      await vscode.workspace.fs.writeFile(binary, Buffer.from([0, 42, 99]));
      await vscode.workspace.fs.writeFile(oversized, Buffer.alloc(262145, 65));
      await messageHandler({ type: 'reindexWorkspace' });
      assert.ok(!engine.indexer.getDocuments().some((document) => ['ignored.txt', 'binary.txt', 'oversized.txt'].includes(document.path)));
      const proposal = await engine.editEngine.proposeEdits(root, [{ path: 'agent-index-edit.txt', newContent: 'RAG_AGENT_EDIT_TOKEN', operation: 'create' }]);
      const accepted = await engine.editEngine.applyProposal(proposal.id);
      assert.equal(accepted.success, true, JSON.stringify(accepted));
      await engine.indexer.whenIdle();
      assert.match((await engine.executeTask('/search RAG_AGENT_EDIT_TOKEN', 'ask')).response, /agent-index-edit.txt/);
      const context = await engine.contextEngine.assembleContext('RAG_AGENT_EDIT_TOKEN', { includeWorkspace: true });
      assert.ok(context.items.some((item) => item.source === 'retrieval' && item.chunk.id.length === 64 && item.chunk.fileHash.length === 64));
      const rollback = await engine.rollbackRecordedChanges(accepted.recoveryId);
      assert.equal(rollback.success, true, JSON.stringify(rollback));
      await engine.indexer.whenIdle();
      assert.match((await engine.executeTask('/search RAG_AGENT_EDIT_TOKEN', 'ask')).response, /No matching indexed/);
      assert.ok(webviewEvents.some((event) => event.type === 'indexStatus' && event.status?.watching && event.status?.chunkCount > 0), 'The actual view IPC must receive real index/chunk status');
      engine.setAccessScope('file', 'package.json');
      await assert.rejects(engine.executeTask('/search RAG_AGENT_EDIT_TOKEN', 'ask'), /unavailable with File access/);
      await assert.rejects(vscode.commands.executeCommand('localforge.reindexWorkspace'), /reindex is unavailable with File access/);
      const reindexMessages = [];
      const originalPost = ext.exports.viewProvider.post;
      ext.exports.viewProvider.post = function(message) { reindexMessages.push(message); return originalPost.call(this, message); };
      try { await messageHandler({ type: 'reindexWorkspace' }); }
      finally { ext.exports.viewProvider.post = originalPost; }
      assert.ok(reindexMessages.some((event) => event.type === 'error' && /reindex is unavailable with File access/.test(event.message)), JSON.stringify(reindexMessages));
      console.log('[WorkspaceRAG] Real create/change/rename/delete watcher events, hashes/chunks, no-model slash search, review/rollback invalidation, ignores/size/binary, index IPC and File scope verified.');
    } finally {
      engine.setAccessScope('workspace'); engine.compositeProvider.chatWithTools = originalChat;
      for (const target of [alpha, moved, ignored, control, binary, oversized, edited]) {
        try { await vscode.workspace.fs.delete(target); } catch (error) { if (error.code !== 'FileNotFound') throw error; }
      }
      await engine.indexer.whenIdle();
    }
  });

  await runStage('Directory argument regression and real File scope enforcement', async () => {
    const api = ext.exports;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(root, 'A real workspace must be open');
    await assert.rejects(api.engine.toolRegistry.executeTool('list_directory', { directory: 'package.json' }, api.engine.permissionManager), /not a directory.*read_file/);
    await assert.rejects(api.engine.toolRegistry.executeTool('list_directory', { invalid: 'package.json' }, api.engine.permissionManager), /requires a path/);
    const listing = await api.engine.toolRegistry.executeTool('list_directory', { path: '' }, api.engine.permissionManager);
    assert.ok(listing.some((entry) => entry.name === 'package.json'));
    assert.equal(api.engine.isBusy(), false, `No engine execution may leak into scope verification: ${JSON.stringify([...activeEngineExecutions.values()])}`);
    api.engine.setAccessScope('file', 'package.json');
    try {
      const file = await api.engine.toolRegistry.executeTool('read_file', { path: 'package.json' }, api.engine.permissionManager);
      assert.match(file.content, /(?:tuxnest|localforge)-vscode/);
      await assert.rejects(api.engine.toolRegistry.executeTool('read_file', { path: 'README.md' }, api.engine.permissionManager), /restricted/);
      await assert.rejects(api.engine.toolRegistry.executeTool('run_command', { command: 'npm test' }, api.engine.permissionManager), /unavailable/);
      await assert.rejects(api.engine.executeTask('/terminal npm test', 'agent'), /unavailable/);
      assert.ok(!api.engine.toolRegistry.getDefinitions().some((tool) => tool.function.name === 'search_workspace'));
    } finally { api.engine.setAccessScope('workspace'); }
  });

  if (process.env.LOCALFORGE_REAL_OLLAMA_EDIT === '1') {
    await runStage('Live Ollama read-only Markdown repository summary', async () => {
      const { AgentLoop } = require('../../dist/agent/agentLoop');
      const { ToolRegistry } = require('../../dist/agent/toolRegistry');
      const { OllamaProvider } = require('../../dist/providers/ollamaProvider');
      const { createRepositorySummaryFormatter, createRepositorySummaryValidator } = require('../../dist/agent/summaryEvidence');
      const api = ext.exports;
      const registry = new ToolRegistry();
      const definition = api.engine.toolRegistry.getTool('read_file').definition;
      let reads = 0;
      registry.registerTool(definition, async (args) => {
        console.log('[LiveSummary] Reading', JSON.stringify(args));
        assert.equal(args.path, 'package.json');
        reads += 1;
        return api.engine.toolRegistry.executeTool('read_file', args, api.engine.permissionManager);
      }, { category: 'read', riskLevel: 'read_only' });
      const provider = new OllamaProvider('http://127.0.0.1:11434', 'ollama', () => ({ num_ctx: 8192, num_predict: 512, temperature: 0.1, seed: 7 }));
      const result = await new AgentLoop(provider, registry, api.engine.permissionManager).run(process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b', [{ role: 'user', content: 'Read package.json using read_file. Answer briefly with only ## Purpose (actual name and purpose), and ## Commands (copy the exact JSON values of scripts.build and scripts.test into code spans). No other commands. Do not write files.' }], { mode: 'ask', requireToolUse: true, formatFinalResponse: createRepositorySummaryFormatter('Summary with actual name. Copy exact scripts.build and scripts.test.'), validateFinalResponse: createRepositorySummaryValidator('Summary with actual name. Copy exact scripts.build and scripts.test.'), maxRounds: 6, timeoutMs: 300000, onModelOutput: (text, round, tools) => console.log('[LiveSummary]', JSON.stringify({ round, tools, text })), onToolEnd: (name, _result, error) => console.log('[LiveSummary] Tool result', name, error || 'success') });
      assert.ok(reads > 0, `The model must actually inspect the project before answering: ${result.response}`);
      assert.equal(result.state.status, 'completed', result.response);
      assert.match(result.response, /#{1,6}\s+\w/);
      const manifest = require('../../package.json');
      assert.ok(result.response.includes(manifest.name));
      assert.ok(result.response.includes(manifest.scripts.build), 'The summary must copy the actual build script');
      assert.ok(result.response.includes(manifest.scripts.test), 'The summary must copy the actual test script');
      assert.doesNotMatch(result.response, /LOCALFORGE_TOOL_CALL|Some tool actions failed/);
      console.log('[ExtensionHost] Real summary:', result.response.slice(0, 2000));
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
