const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const fixture = process.env.LOCALFORGE_CHAT_FIXTURE;
  assert.ok(fixture && path.isAbsolute(fixture));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.equal(path.resolve(root.fsPath).toLowerCase(), path.resolve(fixture, 'project').toLowerCase());
  const extension = vscode.extensions.getExtension('paladuguganeshnaidu.localforge-vscode');
  assert.ok(extension);
  const api = await extension.activate();
  const requests = [];
  const controlledProvider = {
    id: 'chat-fixture', source: 'local', detect: async () => true,
    listModels: async () => ['alpha', 'beta'].map((name) => ({ name, capabilities: { chat: true, toolCalling: true, contextWindow: 8192 } })),
    streamChat: async (_model, messages, onToken, signal) => { signal?.throwIfAborted(); requests.push(messages); onToken('Hello! What would you like to build?'); },
    chatWithTools: async (_model, messages, _tools, signal, onToken) => {
      signal?.throwIfAborted();
      requests.push(messages);
      if (process.env.LOCALFORGE_CHAT_PHASE.startsWith('memory-')) {
        const text = messages.at(-1).content;
        const evidence = text.split('\n').filter((line) => line.startsWith('{"chatId":')).map((line) => JSON.parse(line).text);
        const content = evidence.length ? `Recovered evidence: ${evidence.join('\n')}` : 'No older supporting memory found.';
        onToken?.(content);
        return { role: 'assistant', content };
      }
      const fact = messages.at(-1).content.match(/LOCALFORGE_CHAT_[AB]_FACT_\d+/)?.[0];
      assert.ok(fact);
      const content = `Remembered ${fact}.`;
      onToken?.(content);
      return { role: 'assistant', content };
    }
  };
  api.engine.compositeProvider.addProvider(controlledProvider);
  api.engine.modelRegistry.registerProvider(controlledProvider);
  await api.engine.modelRegistry.refresh();
  const events = [];
  let handler;
  const webview = {
    html: '', cspSource: 'https://*.vscode-cdn.net', asWebviewUri: (uri) => uri,
    onDidReceiveMessage: (callback) => { handler = callback; return { dispose() {} }; },
    postMessage: async (event) => { events.push(structuredClone(event)); return true; }
  };
  api.viewProvider.resolveWebviewView({ webview });
  assert.match(webview.html, /id="chatFilter"/);
  assert.match(webview.html, /type: 'renameSession'/);
  const send = async (message) => {
    const offset = events.length;
    await handler(message);
    assert.deepEqual(events.slice(offset).filter((event) => event.type === 'error'), [], JSON.stringify(events.slice(offset)));
  };
  const history = () => events.filter((event) => event.type === 'history').at(-1).messages.map((message) => message.content);
  const active = () => api.engine.sessionManager.getActiveSession();
  const readMarker = async () => JSON.parse(await fs.readFile(path.join(fixture, 'expected.json'), 'utf8'));
  const unchangedFile = vscode.Uri.joinPath(root, 'kept.txt');
  await send({ type: 'ready' });

  if (process.env.LOCALFORGE_CHAT_PHASE === 'live-edit') {
    const name = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
    const model = api.engine.modelRegistry.getModels().find((entry) => entry.providerId === 'ollama' && entry.name === name);
    assert.ok(model, `Actual Ollama model ${name} is required`);
    await send({ type: 'newSession' });
    await send({ type: 'setMode', mode: 'agent' });
    await send({ type: 'selectModel', model: model.id });
    const originalMode = api.engine.permissionManager.getMode();
    api.engine.permissionManager.setMode('always_proceed');
    const expectedContent = '# Agent Edit Test\nLOMVREN successfully created this file.\n';
    const target = vscode.Uri.joinPath(root, 'agent-edit-test.md');
    const prompt = `Create a file named agent-edit-test.md in the workspace root containing exactly this text, without the quotation marks: "${expectedContent}". Do not modify any other files. If this file already exists, stop and tell me. Show the proposed change for my approval.`;
    const timer = setTimeout(() => api.viewProvider.cancelActiveChat(), 120000);
    try {
      await send({ type: 'chat', prompt, model: model.id, includeContext: true, includeWorkspace: true, agentMode: true });
      assert.equal(api.engine.isBusy(), false);
      const proposals = api.engine.editEngine.getPendingProposals();
      assert.equal(proposals.length, 1, JSON.stringify({ proposals, events: events.slice(-10) }));
      const proposal = proposals[0];
      assert.equal(proposal.files.length, 1);
      assert.equal(proposal.files[0].path, 'agent-edit-test.md');
      assert.equal(proposal.files[0].newContent, expectedContent, 'The live model must not copy task instructions into the file');
      assert.equal(proposal.conversationId, active().id);
      await assert.rejects(vscode.workspace.fs.readFile(target));
      const applied = await api.engine.editEngine.applyProposal(proposal.id);
      assert.equal(applied.success, true, JSON.stringify(applied));
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'), expectedContent);
      await send({ type: 'chat', prompt, model: model.id, includeContext: true, includeWorkspace: true, agentMode: true });
      assert.equal(api.engine.isBusy(), false);
      assert.equal(api.engine.editEngine.getPendingProposals().length, 0, 'The second request must not propose overwriting the existing file');
      assert.equal(Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8'), expectedContent);
      console.log(`[LiveEdit] Real ${model.id}: exact pending preview, no pre-approval file, explicit native acceptance, exact saved bytes and existing-file refusal verified`);
    } finally {
      clearTimeout(timer);
      api.engine.permissionManager.setMode(originalMode);
    }
    return;
  }

  if (['memory-prepare', 'memory-verify', 'live-memory'].includes(process.env.LOCALFORGE_CHAT_PHASE)) {
    const phase = process.env.LOCALFORGE_CHAT_PHASE;
    let ids;
    if (phase !== 'memory-verify') {
      await send({ type: 'newSession' });
      const firstId = active().id;
      await api.engine.sessionManager.appendMessages(firstId, [{ role: 'user', content: 'The internal test codename is ORBITAL-MANGO-91734.', turnId: 'native-old-fact-turn' }]);
      const messageId = active().messages[0].id;
      await api.engine.sessionManager.appendMessages(firstId, Array.from({ length: 24 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `Later unrelated conversation item ${index}.` })));
      await send({ type: 'newSession' });
      const secondId = active().id;
      await api.engine.sessionManager.appendMessages(secondId, [{ role: 'user', content: 'The private lunar codename is SILVER-PEAR-4826.' }]);
      await send({ type: 'loadSession', sessionId: firstId });
      ids = { firstId, secondId, messageId };
    } else {
      ids = await readMarker();
      assert.equal(active().id, ids.firstId);
      assert.equal(active().messages[0].id, ids.messageId);
    }
    await send({ type: 'setMode', mode: 'ask' });
    let modelId = 'chat-fixture:alpha';
    let captured;
    if (phase === 'live-memory') {
      const name = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
      const model = api.engine.modelRegistry.getModels().find((entry) => entry.providerId === 'ollama' && entry.name === name);
      assert.ok(model, `Actual Ollama model ${name} is required`);
      modelId = model.id;
      const provider = api.engine.modelRegistry.getProvider('ollama');
      const original = provider.chatWithTools;
      provider.chatWithTools = async function (model, messages, ...args) { captured = structuredClone(messages); return original.call(this, model, messages, ...args); };
    }
    await send({ type: 'selectModel', model: modelId });
    const ask = async (prompt) => {
      const offset = events.length;
      const timer = setTimeout(() => api.viewProvider.cancelActiveChat(), 120000);
      try { await send({ type: 'chat', prompt, model: modelId, includeContext: true, includeWorkspace: true, agentMode: false }); }
      finally { clearTimeout(timer); }
      const done = events.slice(offset).find((event) => event.type === 'done');
      assert.ok(done?.fullResponse?.trim(), 'A real completed response must be delivered through the view');
      return done.fullResponse;
    };
    const response = await ask('What was the internal test codename I gave earlier?');
    assert.match(response, /ORBITAL-MANGO-91734/);
    const outbound = phase === 'live-memory' ? captured : requests.at(-1);
    assert.ok(outbound);
    assert.doesNotMatch(JSON.stringify(outbound.slice(0, -1)), /ORBITAL-MANGO-91734/);
    assert.match(outbound.at(-1).content, /Retrieved chat evidence/);
    assert.match(outbound.at(-1).content, new RegExp(ids.messageId));
    assert.doesNotMatch(JSON.stringify(outbound), /SILVER-PEAR-4826/);
    const context = await ask('/context');
    assert.match(context, /native-old-fact-turn/);
    assert.match(context, new RegExp(ids.messageId));
    assert.match(context, /ORBITAL-MANGO-91734/);
    assert.match(await ask('/search chat SILVER-PEAR-4826'), /No matching/);
    if (phase === 'live-memory') {
      console.log(`[ChatRestart] Actual Ollama older-memory response: ${JSON.stringify(response)}`);
      console.log(`[ChatRestart] Supporting message ${ids.messageId}; recent context lacks fact; actual outbound evidence and /context verified; private B excluded`);
      return;
    }
    if (phase === 'memory-prepare') {
      await api.engine.sessionManager.appendMessages(ids.firstId, Array.from({ length: 24 }, () => ({ role: 'assistant', content: 'Later unrelated chat before restart.' })));
      await fs.writeFile(path.join(fixture, 'expected.json'), JSON.stringify(ids));
      await api.engine.sessionManager.flush();
      await api.engine.flushActivityHistory();
      console.log('[ChatRestart] Native older-chat retrieval and source inspector saved for real process restart');
      return;
    }
    const originalWarning = vscode.window.showWarningMessage;
    let decision;
    const approvals = [];
    vscode.window.showWarningMessage = async (message, ...args) => { approvals.push(message); return decision; };
    try {
      await send({ type: 'updateSettings', settings: { 'chatMemory.scope': 'all' } });
      assert.equal(vscode.workspace.getConfiguration('localforge.chatMemory').get('scope', 'current'), 'current');
      decision = 'Allow all-chat memory';
      await send({ type: 'updateSettings', settings: { 'chatMemory.scope': 'all' } });
      const configuration = vscode.workspace.getConfiguration('localforge.chatMemory');
      assert.equal(configuration.get('scope'), 'all');
      assert.equal(configuration.inspect('scope').workspaceValue, 'all');
      assert.equal(configuration.inspect('scope').globalValue, undefined);
      assert.equal(approvals.filter((message) => message.includes('Allow retrieval from all chats')).length, 2);
      assert.match(await ask('/search chat SILVER-PEAR-4826'), /SILVER-PEAR-4826/);
      const crossResponse = await ask('What is the private lunar codename?');
      assert.match(crossResponse, /SILVER-PEAR-4826/);
      assert.match(JSON.stringify(requests.at(-1)), /SILVER-PEAR-4826/);
      decision = 'Delete chat';
      await send({ type: 'deleteSession', sessionId: ids.secondId });
      assert.match(await ask('/search chat SILVER-PEAR-4826'), /No matching/);
      await send({ type: 'clear' });
      assert.deepEqual(active().messages, []);
      assert.match(await ask('/search chat ORBITAL-MANGO-91734'), /No matching/);
      await api.engine.sessionManager.flush();
      console.log('[ChatRestart] Restart retrieval, declined/accepted all-chat opt-in, workspace configuration target, deletion and clear verified');
    } finally { vscode.window.showWarningMessage = originalWarning; }
    return;
  }

  if (process.env.LOCALFORGE_CHAT_PHASE === 'greeting') {
    const requestedModel = process.env.LOCALFORGE_OLLAMA_MODEL || 'qwen2.5-coder:1.5b';
    const selected = api.engine.modelRegistry.getModels().find((model) => model.providerId === 'ollama' && model.name === requestedModel);
    assert.ok(selected, `Local Ollama model ${requestedModel} is required for this live test`);
    await api.engine.sessionManager.appendMessages(active().id, [
      { role: 'user', content: 'This project is the Clinch Works learning portal. PRIVATE_PRIOR_PROJECT_DATA' },
      { role: 'assistant', content: 'Welcome to Clinch Works professional training.' }
    ]);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, 'README.md'), Buffer.from('# Clinch Works\nPRIVATE_WORKSPACE_CONTEXT'));
    const provider = api.engine.modelRegistry.getProvider('ollama');
    const originalStream = provider.streamChat;
    let captured;
    let retrievals = 0;
    let referenceReads = 0;
    let toolLoopCalls = 0;
    provider.streamChat = async function (model, messages, onToken, signal) {
      captured = structuredClone(messages);
      return originalStream.call(this, model, messages, onToken, signal);
    };
    const originalRetrieval = api.engine.contextEngine.assembleContext;
    api.engine.contextEngine.assembleContext = async function (...args) { retrievals += 1; return originalRetrieval.apply(this, args); };
    const originalReferences = api.engine.referenceResolver.resolveReferences;
    api.engine.referenceResolver.resolveReferences = async function (...args) { referenceReads += 1; return originalReferences.apply(this, args); };
    const originalRunTask = api.engine.agentEngine.runTask;
    api.engine.agentEngine.runTask = async function (...args) { toolLoopCalls += 1; return originalRunTask.apply(this, args); };
    await send({ type: 'setMode', mode: 'agent' });
    await send({ type: 'selectModel', model: selected.id });
    const offset = events.length;
    const timeout = setTimeout(() => api.viewProvider.cancelActiveChat(), 90000);
    try {
      await send({ type: 'chat', prompt: 'hello', model: selected.id, includeContext: true, includeWorkspace: true, agentMode: true });
    } finally { clearTimeout(timeout); }
    assert.ok(captured);
    assert.equal(captured.length, 2);
    assert.equal(captured[1].content, 'hello');
    assert.doesNotMatch(JSON.stringify(captured), /Clinch|PRIVATE_PRIOR|PRIVATE_WORKSPACE/);
    assert.equal(retrievals, 0);
    assert.equal(referenceReads, 0);
    assert.equal(toolLoopCalls, 0);
    const currentEvents = events.slice(offset);
    const response = currentEvents.find((event) => event.type === 'done')?.fullResponse;
    assert.ok(response?.trim(), 'Real Ollama must return a completed, nonempty greeting');
    assert.doesNotMatch(response, /Clinch Works|professional learning journey|training portal/i);
    assert.ok(currentEvents.some((event) => event.type === 'chunk'));
    assert.equal(active().messages.at(-1).model, selected.id);
    assert.equal(active().messages.at(-1).providerId, 'ollama');
    assert.equal(api.engine.artifactManager.getArtifactsByConversation(active().id).length, 0);
    assert.deepEqual(api.engine.editEngine.getPendingProposals(), []);
    console.log(`[ChatRestart] Actual ${requestedModel} response: ${JSON.stringify(response)}`);
    console.log('[ChatRestart] Exact outbound messages verified; workspace/references/tool-loop calls: 0/0/0');
    return;
  }

  if (process.env.LOCALFORGE_CHAT_PHASE === 'prepare') {
    await send({ type: 'newSession' });
    const firstId = active().id;
    await send({ type: 'setMode', mode: 'ask' });
    await send({ type: 'selectModel', model: 'chat-fixture:alpha' });
    await send({ type: 'chat', prompt: 'Remember LOCALFORGE_CHAT_A_FACT_7391', model: 'chat-fixture:alpha', includeContext: true, includeWorkspace: true, agentMode: false });
    assert.equal(active().messages.at(-1).providerId, 'chat-fixture');
    const firstHistory = active().messages.map((message) => message.content);
    const proposal = await api.engine.editEngine.proposeEdits(root, [{ path: 'kept.txt', newContent: 'USER FILE MUST SURVIVE CHAT DELETION' }]);
    const applied = await api.engine.editEngine.applyProposal(proposal.id);
    assert.equal(applied.success, true);
    assert.ok(applied.recoveryId);
    await send({ type: 'newSession' });
    const secondId = active().id;
    await send({ type: 'setMode', mode: 'ask' });
    await send({ type: 'selectModel', model: 'chat-fixture:alpha' });
    await send({ type: 'chat', prompt: 'Remember LOCALFORGE_CHAT_B_FACT_4826', model: 'chat-fixture:alpha', includeContext: true, includeWorkspace: true, agentMode: false });
    assert.doesNotMatch(JSON.stringify(requests.at(-1)), /LOCALFORGE_CHAT_A_FACT_7391/);
    const secondHistory = active().messages.map((message) => message.content);
    for (const id of [firstId, secondId, firstId, secondId, firstId]) {
      await send({ type: 'loadSession', sessionId: id });
      assert.deepEqual(history(), id === firstId ? firstHistory : secondHistory);
    }
    await send({ type: 'selectModel', model: 'chat-fixture:beta' });
    assert.deepEqual(history(), firstHistory);
    assert.equal(active().model, 'chat-fixture:beta');
    await fs.writeFile(path.join(fixture, 'expected.json'), JSON.stringify({ firstId, secondId, firstHistory, secondHistory, recoveryId: applied.recoveryId }));
    await api.engine.sessionManager.flush();
    await api.engine.flushActivityHistory();
    console.log('[ChatRestart] Separate A/B histories and within-chat model change saved');
    return;
  }

  const expected = await readMarker();
  if (process.env.LOCALFORGE_CHAT_PHASE === 'modify') {
    assert.equal(active().id, expected.firstId);
    assert.equal(active().model, 'chat-fixture:beta');
    assert.deepEqual(history(), expected.firstHistory);
    await send({ type: 'loadSession', sessionId: expected.secondId });
    assert.deepEqual(history(), expected.secondHistory);
    const originalInput = vscode.window.showInputBox;
    const originalWarning = vscode.window.showWarningMessage;
    try {
      vscode.window.showInputBox = async () => 'Renamed B after restart';
      await send({ type: 'renameSession', sessionId: expected.secondId });
      vscode.window.showWarningMessage = async () => undefined;
      await send({ type: 'deleteSession', sessionId: expected.firstId });
      assert.ok(api.engine.sessionManager.getSessions().some((session) => session.id === expected.firstId));
      vscode.window.showWarningMessage = async () => 'Delete chat';
      await send({ type: 'deleteSession', sessionId: expected.firstId });
    } finally {
      vscode.window.showInputBox = originalInput;
      vscode.window.showWarningMessage = originalWarning;
    }
    assert.equal(api.engine.sessionManager.getSessions().some((session) => session.id === expected.firstId), false);
    assert.deepEqual(history(), expected.secondHistory);
    assert.equal(Buffer.from(await vscode.workspace.fs.readFile(unchangedFile)).toString(), 'USER FILE MUST SURVIVE CHAT DELETION');
    assert.ok(api.engine.editEngine.getRecoveryHistory().some((record) => record.id === expected.recoveryId));
    assert.deepEqual(api.engine.getActivityHistory(expected.firstId), []);
    await send({ type: 'clear' });
    assert.deepEqual(history(), []);
    assert.deepEqual(active().messages, []);
    assert.deepEqual(api.engine.getActivityHistory(expected.secondId), []);
    await send({ type: 'chat', prompt: 'Remember LOCALFORGE_CHAT_B_FACT_4826', model: 'chat-fixture:alpha', includeContext: true, includeWorkspace: true, agentMode: false });
    assert.equal(active().messages.length, 2);
    assert.ok(api.engine.getActivityHistory(expected.secondId).length);
    await send({ type: 'chat', prompt: '/clear', model: 'chat-fixture:alpha', includeContext: true, includeWorkspace: true, agentMode: false });
    assert.deepEqual(history(), []);
    assert.deepEqual(active().messages, []);
    assert.deepEqual(api.engine.getActivityHistory(expected.secondId), []);
    await api.engine.sessionManager.flush();
    await api.engine.flushActivityHistory();
    console.log('[ChatRestart] Rename, denied/accepted delete, UI clear and /clear verified');
    return;
  }

  assert.equal(active().id, expected.secondId);
  assert.equal(active().title, 'Renamed B after restart');
  assert.deepEqual(history(), []);
  assert.equal(api.engine.sessionManager.getSessions().some((session) => session.id === expected.firstId), false);
  assert.deepEqual(api.engine.getActivityHistory(expected.firstId), []);
  assert.deepEqual(api.engine.getActivityHistory(expected.secondId), []);
  assert.ok(api.engine.editEngine.getRecoveryHistory().some((record) => record.id === expected.recoveryId));
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(unchangedFile)).toString(), 'USER FILE MUST SURVIVE CHAT DELETION');
  console.log('[ChatRestart] Deleted chat stays deleted, renamed/cleared B restored, file and recovery preserved');
}

module.exports = { run };
