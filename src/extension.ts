import * as vscode from 'vscode';
import { applyReviewedSelection } from './editing/selectionEdits';
import { randomUUID } from 'node:crypto';
import { LocalForgeEngine } from './core/LocalForgeEngine';
import { LocalForgeViewProvider } from './ui/chatView';
import { ModelCenterViewProvider } from './ui/modelCenter';
import { LocalForgeCompletionProvider } from './completion/completionProvider';
import { isWebviewMessage } from './ui/webviewMessages';
import { validateRelativeWorkspacePath } from './agent/workspaceTools';
import { ChatMessage } from './providers/modelProvider';
import { findRelevantSnippets } from './context/workspaceContext';
import { RemoteGpuProfile, readPrivateKey } from './remote/sshOllamaTunnel';
import { REMOTE_PROFILES_KEY } from './remote/remoteManager';

export {
  isWebviewMessage,
  validateRelativeWorkspacePath
};

export function cleanModelCodeOutput(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[^\n]*\r?\n/, '');
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/\r?\n```$/, '');
  }
  return cleaned.trim();
}

export function formatExplainPrompt(code: string, languageId: string, relativePath: string): string {
  return `Please explain the following ${languageId} code from ${relativePath}:\n\n\`\`\`${languageId}\n${code.slice(0, 20000)}\n\`\`\``;
}

export function formatFixPrompt(
  code: string,
  languageId: string,
  relativePath: string,
  instruction: string,
  diagnostics: string[] = []
): ChatMessage[] {
  const issues = diagnostics.length
    ? `\nReported issues/diagnostics:\n${diagnostics.map((d) => `- ${d}`).join('\n')}\n`
    : '';
  return [
    {
      role: 'system',
      content: 'You are a careful coding assistant. Return only the complete replacement text for the supplied code to fix the issue. Do not use markdown fences, notes, or explanations.'
    },
    {
      role: 'user',
      content: `File: ${relativePath}\nLanguage: ${languageId}${issues}\nFix requested: ${instruction}\n\nCode to replace:\n${code.slice(0, 30000)}`
    }
  ];
}

let engineInstance: LocalForgeEngine | undefined;

export interface LocalForgeExtensionApi {
  engine: LocalForgeEngine;
  viewProvider: LocalForgeViewProvider;
}

export async function activate(context: vscode.ExtensionContext): Promise<LocalForgeExtensionApi> {
  const ollamaUrl = vscode.workspace.getConfiguration('tuxnest.ollama').get<string>('baseUrl', 'http://127.0.0.1:11434');
  const openAiUrls = vscode.workspace.getConfiguration('tuxnest.providers').get<string>('openAICompatibleUrls', '');

  const engine = new LocalForgeEngine(context, {
    ollamaEndpoint: ollamaUrl,
    openAiEndpoints: openAiUrls
  });
  engineInstance = engine;
  await engine.initializeConversationHistory();

  const viewProvider = new LocalForgeViewProvider(engine.compositeProvider, context, engine);
  const modelCenterProvider = new ModelCenterViewProvider(engine.compositeProvider, async () => {
    await engine.modelRegistry.discoverAll();
    await viewProvider.refresh();
  });
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration('tuxnest.ollama.baseUrl') && !event.affectsConfiguration('tuxnest.providers.openAICompatibleUrls')) return;
    void engine.updateProviderConfiguration({
      ollamaEndpoint: vscode.workspace.getConfiguration('tuxnest.ollama').get<string>('baseUrl', 'http://127.0.0.1:11434'),
      openAiEndpoints: vscode.workspace.getConfiguration('tuxnest.providers').get<string>('openAICompatibleUrls', '')
    }).then(() => viewProvider.refresh()).catch((error) => vscode.window.showErrorMessage(`Could not update providers: ${error instanceof Error ? error.message : 'Unknown provider error'}`));
  }));

  const completionProvider = new LocalForgeCompletionProvider(
    engine.compositeProvider,
    () => vscode.workspace.getConfiguration('tuxnest.autocomplete').get<boolean>('enabled', false),
    () => viewProvider.modelForTask('completion')
  );

  context.subscriptions.push(
    modelCenterProvider,
    vscode.window.registerWebviewViewProvider('tuxnest.chatView', viewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider('tuxnest.modelsView', modelCenterProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.workspace.registerTextDocumentContentProvider(
      'tuxnest-proposed',
      engine.editEngine.createContentProvider()
    ),
    vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, completionProvider),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        viewProvider.postActiveEditor(vscode.workspace.asRelativePath(editor.document.uri));
      }
    }),

    vscode.commands.registerCommand('tuxnest.refreshModels', async () => {
      try {
        await engine.bootstrap();
        await viewProvider.refresh();
        void vscode.window.showInformationMessage('TuxNest model registry refreshed.');
      } catch (err: any) {
        void vscode.window.showErrorMessage(`Model refresh failed: ${err.message || String(err)}`);
      }
    }),

    vscode.commands.registerCommand('tuxnest.explain', async () => {
      await explainSelection(viewProvider);
    }),

    vscode.commands.registerCommand('tuxnest.fix', async () => {
      await fixSelection(engine, viewProvider);
    }),

    vscode.commands.registerCommand('tuxnest.editSelection', async () => {
      await proposeEdit(engine, viewProvider);
    }),

    vscode.commands.registerCommand('tuxnest.searchWorkspace', async () => {
      await searchWorkspace();
    }),

    vscode.commands.registerCommand('tuxnest.configureRemote', async () => {
      await configureRemoteProfile(context);
    }),

    vscode.commands.registerCommand('tuxnest.connectRemote', async () => {
      await connectRemote(context, engine, viewProvider);
    }),

    vscode.commands.registerCommand('tuxnest.disconnectRemote', async () => {
      await engine.remoteManager.disconnect();
      viewProvider.setRemoteSession(undefined);
      await viewProvider.refresh();
      void vscode.window.showInformationMessage('Disconnected from remote GPU host.');
    }),

    vscode.commands.registerCommand('tuxnest.remoteGpuStatus', async () => {
      const session = engine.remoteManager.getActiveSession();
      if (!session) {
        void vscode.window.showInformationMessage('No active remote GPU connection. Use "Connect to Remote GPU Host" first.');
        return;
      }
      try {
        const statuses = await engine.remoteManager.refreshGpuStatus();
        if (statuses.length > 0) {
          const summary = statuses.map((g) => g.displayText).join('\n');
          void vscode.window.showInformationMessage(`Remote GPU Status:\n${summary}`);
        } else {
          void vscode.window.showInformationMessage('Connected via SSH tunnel. No NVIDIA GPU status returned.');
        }
      } catch (err: any) {
        void vscode.window.showErrorMessage(`GPU status probe failed: ${err.message}`);
      }
    }),

    vscode.commands.registerCommand('tuxnest.diagnose', async () => {
      const report = await engine.diagnosticsService.runDiagnostics();
      const markdown = engine.diagnosticsService.formatReportMarkdown(report);
      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('tuxnest.doctor', async () => {
      const report = await engine.diagnosticsService.runDiagnostics();
      const markdown = engine.diagnosticsService.formatReportMarkdown(report);
      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: 'markdown'
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),

    vscode.commands.registerCommand('tuxnest.selfTest', async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Running TuxNest SI Agent Self-Test...' },
        async () => {
          const report = await engine.selfTest.runSelfTest();
          const markdown = engine.selfTest.formatReportMarkdown(report);
          const doc = await vscode.workspace.openTextDocument({
            content: markdown,
            language: 'markdown'
          });
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      );
    }),

    vscode.commands.registerCommand('tuxnest.continueTask', async () => {
      const lastTask = engine.taskManager.getLastTask();
      if (!lastTask) {
        void vscode.window.showInformationMessage('No previous task found in this workspace.');
        return;
      }
      await vscode.commands.executeCommand('tuxnest.chatView.focus');
      const msg = `Continuing previous task:\n"${lastTask.task}"\nStatus was: ${lastTask.status}.\nPlease continue and finalize the work.`;
      await viewProvider.sendUserPrompt(msg, { mode: lastTask.mode });
    }),

    vscode.commands.registerCommand('tuxnest.newSession', async () => {
      await viewProvider.startNewSession();
      await viewProvider.refresh();
      void vscode.window.showInformationMessage('Started new TuxNest session.');
    }),

    vscode.commands.registerCommand('tuxnest.newConversation', async () => {
      await viewProvider.startNewSession();
      await viewProvider.refresh();
      void vscode.window.showInformationMessage('Started new TuxNest conversation.');
    }),

    vscode.commands.registerCommand('tuxnest.openAgent', async () => {
      await vscode.commands.executeCommand('tuxnest.chatView.focus');
    }),

    vscode.commands.registerCommand('tuxnest.cancelAgent', () => {
      engine.cancelCurrentTask();
      viewProvider.cancelActiveChat();
      void vscode.window.showInformationMessage('TuxNest SI Agent task cancelled.');
    }),

    vscode.commands.registerCommand('tuxnest.reviewChanges', async () => {
      const proposals = engine.editEngine.getPendingProposals();
      if (!proposals.length) {
        void vscode.window.showInformationMessage('No pending changes to review.');
        return;
      }
      const latest = proposals[0];
      if (latest.files.length > 0) {
        await engine.editEngine.showDiff(latest.id, latest.files[0].path);
      }
    }),

    vscode.commands.registerCommand('tuxnest.undoChanges', async (recoveryId?: string) => {
      let selectedId = typeof recoveryId === 'string' ? recoveryId : undefined;
      if (!selectedId) {
        const records = engine.editEngine.getRecoveryHistory().filter((record) => record.remainingFiles.length > 0);
        if (!records.length) {
          void vscode.window.showInformationMessage('No recorded changes are available to restore.');
          return;
        }
        const selected = await vscode.window.showQuickPick(records.map((record) => ({
          label: record.summary, description: record.status.replace(/_/g, ' '),
          detail: `${record.remainingFiles.length} file(s) · ${new Date(record.createdAt).toLocaleString()}`, id: record.id
        })), { placeHolder: 'Choose the recorded edit to restore' });
        selectedId = selected?.id;
      }
      if (selectedId) await viewProvider.rollbackRecordedChanges(selectedId);
    }),

    vscode.commands.registerCommand('tuxnest.showArtifacts', async () => {
      const session = engine.sessionManager.getActiveSession();
      const artifacts = engine.artifactManager.getArtifactsByConversation(session.id);
      if (!artifacts.length) {
        void vscode.window.showInformationMessage('No artifacts generated in this session yet.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        artifacts.map((a) => ({ label: a.title, description: a.type, detail: a.status, artifact: a }))
      );
      if (pick) {
        const doc = await vscode.workspace.openTextDocument({
          content: pick.artifact.content,
          language: 'markdown'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    }),

    vscode.commands.registerCommand('tuxnest.setAgentMode', async (targetMode?: string) => {
      let mode = targetMode;
      if (!mode) {
        const pick = await vscode.window.showQuickPick(['Ask', 'Plan', 'Agent'], {
          placeHolder: 'Select TuxNest mode'
        });
        if (pick) mode = pick.toLowerCase();
      }
      if (mode) {
        viewProvider.activeMode = mode.toLowerCase() as any;
        void vscode.window.showInformationMessage(`TuxNest mode set to: ${mode}`);
      }
    }),

    vscode.commands.registerCommand('tuxnest.setModel', async (targetModel?: string) => {
      let modelId = targetModel;
      if (!modelId) {
        const models = engine.modelRegistry.getModels();
        const items = [
          { label: 'Auto', description: 'Smart capability-based task routing', id: 'auto' },
          ...models.map((m) => ({
            label: m.displayName || m.name,
            description: `${m.providerId} (${m.source})`,
            id: m.id || m.name
          }))
        ];
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select active model' });
        if (pick) modelId = pick.id;
      }
      if (modelId) {
        await viewProvider.setSelectedModel(modelId);
        void vscode.window.showInformationMessage(`Selected model: ${modelId}`);
      }
    }),

    vscode.commands.registerCommand('tuxnest.reindexWorkspace', async () => {
      if (engine.accessPolicy.getState().scope === 'file') throw new Error('Workspace reindex is unavailable with File access.');
      if (engine.indexer) {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Re-indexing workspace context...', cancellable: true },
          async (_progress, token) => {
            const count = await engine.indexer!.indexWorkspace(token);
            void vscode.window.showInformationMessage(`Indexed ${count} workspace files for TuxNest.`);
          }
        );
      }
    })
  );

  // Initialize engine background tasks
  void engine.bootstrap().then(() => viewProvider.refresh());

  return { engine, viewProvider };
}

export async function deactivate(): Promise<void> {
  if (engineInstance) {
    engineInstance.cancelCurrentTask();
    engineInstance.indexer?.dispose();
    await Promise.allSettled([engineInstance.remoteManager.disconnect(), engineInstance.browserTool.dispose()]);
    await engineInstance.terminalManager.stopAllProcesses();
    await engineInstance.flushActivityHistory();
  }
}

async function explainSelection(viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file and select code for TuxNest to explain.');
    return;
  }
  const targetRange = editor.selection.isEmpty
    ? new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(editor.document.getText().length))
    : editor.selection;
  const original = editor.document.getText(targetRange);
  if (!original.trim()) {
    void vscode.window.showInformationMessage('Select non-empty code to explain.');
    return;
  }
  await vscode.commands.executeCommand('tuxnest.chatView.focus');
  const relPath = vscode.workspace.asRelativePath(editor.document.uri);
  const prompt = formatExplainPrompt(original, editor.document.languageId, relPath);
  await viewProvider.sendUserPrompt(prompt, { includeContext: false, mode: 'ask' });
}

async function fixSelection(engine: LocalForgeEngine, viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file before asking TuxNest to fix code.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('TuxNest code fixes require a trusted workspace.');
    return;
  }

  const documentVersion = editor.document.version;
  const targetRange = editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).range
    : editor.selection;
  const original = editor.document.getText(targetRange);
  if (!original.trim()) {
    void vscode.window.showInformationMessage('Select code or place the cursor on code you want TuxNest to fix.');
    return;
  }

  const allDiagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  const relevantDiagnostics = allDiagnostics.filter((d) =>
    targetRange.intersection(d.range) || targetRange.contains(d.range.start) || targetRange.contains(d.range.end)
  );
  const diagnosticMessages = relevantDiagnostics.map((d) => `[Line ${d.range.start.line + 1}] ${d.message}`);

  const defaultPrompt = diagnosticMessages.length
    ? `Fix diagnostics: ${diagnosticMessages[0]}`
    : 'Fix bug or issue in selected code';

  const instruction = await vscode.window.showInputBox({
    title: 'TuxNest: Fix code',
    prompt: diagnosticMessages.length
      ? `Found ${diagnosticMessages.length} issue(s) at selection. Describe the fix or press Enter to address diagnostics.`
      : 'Describe what to fix in the selected code.',
    value: defaultPrompt,
    ignoreFocusOut: true
  });
  if (instruction === undefined) return;

  const model = viewProvider.modelForTask('edit') || viewProvider.selectedModel;
  if (!model) {
    void vscode.window.showWarningMessage('No local model is available. Start Ollama and install a model first.');
    return;
  }

  const controller = new AbortController();
  const messages = formatFixPrompt(
    original,
    editor.document.languageId,
    vscode.workspace.asRelativePath(editor.document.uri),
    instruction.trim() || defaultPrompt,
    diagnosticMessages
  );

  let replacement = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'TuxNest is generating a fix', cancellable: true },
      async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
          await engine.compositeProvider.streamChat(
            model,
            messages,
            (chunk) => {
              replacement += chunk;
              progress.report({ message: `${replacement.length.toLocaleString()} characters` });
            },
            controller.signal
          );
        } finally {
          cancellation.dispose();
        }
      }
    );
  } catch (error: any) {
    void vscode.window.showErrorMessage(`Fix generation failed: ${error.message || String(error)}`);
    return;
  }

  if (!replacement.trim() || controller.signal.aborted) return;
  replacement = cleanModelCodeOutput(replacement);

  const originalDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: original });
  const proposedDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: replacement });
  await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, proposedDoc.uri, 'TuxNest: Review proposed fix');
  const choice = await vscode.window.showInformationMessage('Review the diff. Apply this fix to the original file?', 'Apply', 'Discard');
  if (choice !== 'Apply') return;

  if (editor.document.isClosed || editor.document.version !== documentVersion) {
    void vscode.window.showWarningMessage('The source file changed while the proposal was open. Re-run the fix so the diff is based on current content.');
    return;
  }

  await applyRecordedSelection(engine, viewProvider, editor.document, targetRange, replacement, controller.signal);
}

async function proposeEdit(engine: LocalForgeEngine, viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file before asking TuxNest to edit code.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('TuxNest edits require a trusted workspace.');
    return;
  }

  const documentVersion = editor.document.version;
  const targetRange = editor.selection.isEmpty
    ? new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(editor.document.getText().length))
    : editor.selection;
  const original = editor.document.getText(targetRange);
  if (!original.trim()) {
    void vscode.window.showInformationMessage('Select non-empty code or open a non-empty file to propose an edit.');
    return;
  }

  const model = viewProvider.modelForTask('edit') || viewProvider.selectedModel;
  if (!model) {
    void vscode.window.showWarningMessage('No local model is available. Start Ollama and install a model first.');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    title: 'TuxNest: Edit code',
    prompt: 'Describe the change. The selected code, or the whole file if nothing is selected, is sent to the selected model.',
    placeHolder: 'e.g. Add input validation and preserve the current API',
    ignoreFocusOut: true
  });
  if (!instruction?.trim()) return;

  const controller = new AbortController();
  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are a careful coding assistant. Return only the complete replacement text for the supplied code. Do not use markdown fences or explanations.' },
    { role: 'user', content: `File: ${vscode.workspace.asRelativePath(editor.document.uri)}\nLanguage: ${editor.document.languageId}\nChange requested: ${instruction}\n\nCode to replace:\n${original.slice(0, 30000)}` }
  ];

  let replacement = '';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'TuxNest is preparing an edit', cancellable: true },
      async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
          await engine.compositeProvider.streamChat(
            model,
            messages,
            (chunk) => {
              replacement += chunk;
              progress.report({ message: `${replacement.length.toLocaleString()} characters` });
            },
            controller.signal
          );
        } finally {
          cancellation.dispose();
        }
      }
    );
  } catch (error: any) {
    void vscode.window.showErrorMessage(`Edit generation failed: ${error.message || String(error)}`);
    return;
  }

  if (!replacement.trim() || controller.signal.aborted) return;
  replacement = cleanModelCodeOutput(replacement);

  const originalDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: original });
  const proposedDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: replacement });
  await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, proposedDoc.uri, 'TuxNest: Review proposed edit');
  const choice = await vscode.window.showInformationMessage('Review the diff. Apply this edit to the original file?', 'Apply', 'Discard');
  if (choice !== 'Apply') return;

  if (editor.document.isClosed || editor.document.version !== documentVersion) {
    void vscode.window.showWarningMessage('The source file changed while the proposal was open. Re-run the edit so the diff is based on current content.');
    return;
  }

  await applyRecordedSelection(engine, viewProvider, editor.document, targetRange, replacement, controller.signal);
}

async function applyRecordedSelection(
  engine: LocalForgeEngine,
  viewProvider: LocalForgeViewProvider,
  document: vscode.TextDocument,
  range: vscode.Range,
  replacement: string,
  signal: AbortSignal
): Promise<void> {
  try {
    if (engine.isBusy()) throw new Error('Wait for the running task before applying a selection edit.');
    const result = await applyReviewedSelection(engine.editEngine, document, range, replacement, signal);
    if (!result.success) throw new Error(result.errors.map((error) => error.error).join('\n'));
    void vscode.window.showInformationMessage('TuxNest saved the reviewed edit. Recorded Undo is available in Changes or the command palette.');
  } catch (error) {
    void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  } finally {
    viewProvider.postRecoveryHistory();
  }
}

async function searchWorkspace(): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Workspace search requires a trusted workspace.');
    return;
  }
  const query = await vscode.window.showInputBox({ title: 'TuxNest: Search workspace', prompt: 'Find files and code related to a question or symbol' });
  if (!query?.trim()) return;
  try {
    const snippets = await findRelevantSnippets(query, { maxFiles: 12, maxChars: 20000 });
    if (!snippets.length) {
      void vscode.window.showInformationMessage('No matching workspace code was found.');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      snippets.map((snippet) => ({
        label: `${snippet.path}:${snippet.startLine}`,
        description: snippet.text.replace(/\s+/g, ' ').slice(0, 140),
        snippet
      })),
      { title: 'TuxNest workspace matches' }
    );
    if (!selected) return;
    const document = await vscode.workspace.openTextDocument(selected.snippet.uri);
    const editor = await vscode.window.showTextDocument(document);
    const line = Math.max(0, selected.snippet.startLine - 1);
    editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
  } catch (error: any) {
    void vscode.window.showErrorMessage(`Workspace search failed: ${error.message || String(error)}`);
  }
}

async function configureRemoteProfile(context: vscode.ExtensionContext): Promise<void> {
  const name = await vscode.window.showInputBox({ title: 'Remote GPU profile', prompt: 'A recognizable name for this remote machine (e.g. Lambda Labs, RunPod, Home RTX 4090)' });
  if (!name?.trim()) return;
  const host = await vscode.window.showInputBox({ title: name, prompt: 'SSH hostname or IP address' });
  if (!host?.trim()) return;
  const portText = await vscode.window.showInputBox({ title: name, prompt: 'SSH port', value: '22', validateInput: validatePort });
  if (!portText) return;
  const username = await vscode.window.showInputBox({ title: name, prompt: 'SSH username' });
  if (!username?.trim()) return;
  const authMethod = await vscode.window.showQuickPick([
    { label: 'SSH private key', value: 'privateKey' as const },
    { label: 'Password', value: 'password' as const }
  ], { title: 'Choose SSH authentication' });
  if (!authMethod) return;

  let privateKeyPath: string | undefined;
  let secret = '';
  if (authMethod.value === 'privateKey') {
    privateKeyPath = await vscode.window.showInputBox({ title: name, prompt: 'Full path to your SSH private key file (for example ~/.ssh/id_ed25519)' });
    if (!privateKeyPath?.trim()) return;
    secret = (await vscode.window.showInputBox({ title: name, prompt: 'Private key passphrase, if required (leave blank if none)', password: true })) ?? '';
  } else {
    const password = await vscode.window.showInputBox({ title: name, prompt: 'SSH password (stored in VS Code SecretStorage)', password: true, ignoreFocusOut: true });
    if (!password) return;
    secret = password;
  }

  const remoteOllamaHost = await vscode.window.showInputBox({ title: name, prompt: 'Remote Ollama host as seen by the SSH server', value: '127.0.0.1' });
  if (!remoteOllamaHost?.trim()) return;
  const remoteOllamaPortText = await vscode.window.showInputBox({ title: name, prompt: 'Remote Ollama port', value: '11434', validateInput: validatePort });
  if (!remoteOllamaPortText) return;

  const profiles = context.globalState.get<RemoteGpuProfile[]>(REMOTE_PROFILES_KEY, []);
  const existing = profiles.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  const profile: RemoteGpuProfile = {
    id: existing?.id ?? randomUUID(),
    name: name.trim(),
    host: host.trim(),
    port: Number(portText),
    username: username.trim(),
    remoteOllamaHost: remoteOllamaHost.trim(),
    remoteOllamaPort: Number(remoteOllamaPortText),
    hostFingerprint: existing?.hostFingerprint,
    authenticationMethod: authMethod.value,
    privateKeyPath
  };
  await context.globalState.update(REMOTE_PROFILES_KEY, [...profiles.filter((item) => item.id !== profile.id), profile]);
  await context.secrets.store(`tuxnest.remote.${profile.id}.credential`, JSON.stringify({ secret }));
  void vscode.window.showInformationMessage(`Saved remote profile “${profile.name}”. Secrets are stored in VS Code SecretStorage.`);
}

async function connectRemote(
  context: vscode.ExtensionContext,
  engine: LocalForgeEngine,
  viewProvider: LocalForgeViewProvider
): Promise<void> {
  const profiles = engine.remoteManager.getProfiles();
  if (!profiles.length) {
    const create = await vscode.window.showInformationMessage('No remote GPU profiles configured yet. Create one now?', 'Configure GPU Host', 'Cancel');
    if (create === 'Configure GPU Host') {
      await configureRemoteProfile(context);
    }
    return;
  }
  const selected = await vscode.window.showQuickPick(
    profiles.map((profile) => ({ label: profile.name, description: `${profile.username}@${profile.host}:${profile.port}`, profile })),
    { title: 'Connect to remote GPU host' }
  );
  if (!selected) return;

  try {
    const session = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Connecting to ${selected.profile.name} (SSH tunnel)` },
      async () => engine.remoteManager.connect(selected.profile.id)
    );
    viewProvider.setRemoteSession({
      tunnel: session.tunnel,
      providerId: session.providerId,
      profileName: session.profile.name
    });
    await viewProvider.refresh();
    void vscode.window.showInformationMessage(`SSH tunnel to ${selected.profile.name} is active. Heavy models run remotely on your GPU!`);
  } catch (error: any) {
    void vscode.window.showErrorMessage(`Remote GPU connection failed: ${error.message || String(error)}`);
  }
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? undefined : 'Enter a port from 1 to 65535.';
}
