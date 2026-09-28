import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { ChatMessage, LocalModel, ModelProvider } from './providers/modelProvider';
import { OllamaProvider } from './providers/ollamaProvider';
import { OpenAiCompatibleProvider } from './providers/openAiCompatibleProvider';
import { CompositeProvider } from './providers/compositeProvider';
import { ModelTask, routeModel } from './providers/modelRouter';
import { RemoteGpuProfile, SshOllamaTunnel, readPrivateKey } from './remote/sshOllamaTunnel';
import { findRelevantSnippets } from './context/workspaceContext';
import { LocalForgeCompletionProvider } from './features/completionProvider';
import { AgentMode, runToolAgent } from './agent/toolAgent';
import { allWorkspaceTools, executeWorkspaceTool, readOnlyWorkspaceTools } from './agent/workspaceTools';

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'cancel' }
  | { type: 'clear' }
  | { type: 'selectModel'; model: string }
  | { type: 'setMode'; mode: AgentMode }
  | { type: 'connectRemote' }
  | { type: 'disconnectRemote' }
  | { type: 'configureRemote' }
  | { type: 'getRemoteStatus' }
  | { type: 'openFile'; path: string }
  | {
      type: 'chat';
      model: string;
      prompt: string;
      mode?: AgentMode;
      agentMode?: boolean;
      includeContext: boolean;
      includeWorkspace: boolean;
    };

export function activate(context: vscode.ExtensionContext): void {
  const provider = createProvider();
  const viewProvider = new LocalForgeViewProvider(provider, context);
  let remoteSession: { tunnel: SshOllamaTunnel; providerId: string; profileName: string } | undefined;

  const completionProvider = new LocalForgeCompletionProvider(
    provider,
    () => vscode.workspace.getConfiguration('localforge.autocomplete').get<boolean>('enabled', false),
    () => viewProvider.modelForTask('completion')
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('localforge.chatView', viewProvider),
    vscode.commands.registerCommand('localforge.refreshModels', () => viewProvider.refresh()),
    vscode.commands.registerCommand('localforge.editSelection', () => proposeEdit(provider, viewProvider)),
    vscode.commands.registerCommand('localforge.explain', () => explainSelection(viewProvider)),
    vscode.commands.registerCommand('localforge.fix', () => fixSelection(provider, viewProvider)),
    vscode.commands.registerCommand('localforge.searchWorkspace', () => searchWorkspace()),
    vscode.commands.registerCommand('localforge.configureRemote', () => configureRemoteProfile(context)),
    vscode.commands.registerCommand('localforge.connectRemote', () => {
      if (remoteSession) {
        return void vscode.window.showInformationMessage('A remote GPU connection is already active. Disconnect it before connecting to another profile.');
      }
      return connectRemote(context, provider, viewProvider, (session) => {
        remoteSession = session;
        viewProvider.setRemoteSession(session);
      });
    }),
    vscode.commands.registerCommand('localforge.disconnectRemote', async () => {
      if (!remoteSession) return void vscode.window.showInformationMessage('No remote GPU connection is active.');
      const session = remoteSession;
      remoteSession = undefined;
      provider.removeProvider(session.providerId);
      await session.tunnel.close();
      viewProvider.setRemoteSession(undefined);
      await viewProvider.refresh();
      void vscode.window.showInformationMessage('Disconnected from the remote model host and closed its SSH tunnel.');
    }),
    vscode.commands.registerCommand('localforge.remoteGpuStatus', async () => {
      if (!remoteSession) return void vscode.window.showInformationMessage('Connect a remote GPU host first.');
      try {
        const status = await remoteSession.tunnel.getGpuStatus();
        void vscode.window.showInformationMessage(`Remote NVIDIA GPU status: ${status}`);
      } catch (error) {
        void vscode.window.showWarningMessage(errorMessage(error));
      }
    }),
    vscode.languages.registerInlineCompletionItemProvider({ scheme: 'file' }, completionProvider),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        viewProvider.postActiveEditor(vscode.workspace.asRelativePath(editor.document.uri));
      }
    })
  );

  context.subscriptions.push(new vscode.Disposable(() => { if (remoteSession) void remoteSession.tunnel.close(); }));
  void viewProvider.refresh();
}

function createProvider(): CompositeProvider {
  const baseUrl = vscode.workspace.getConfiguration('localforge.ollama').get<string>('baseUrl', 'http://127.0.0.1:11434');
  const endpoints = vscode.workspace.getConfiguration('localforge.providers').get<string>('openAICompatibleUrls',
    'http://127.0.0.1:1234/v1,http://127.0.0.1:8080/v1,http://127.0.0.1:8000/v1'
  ).split(',').map((url) => url.trim()).filter(Boolean);
  return new CompositeProvider([
    new OllamaProvider(baseUrl.replace(/\/$/, '')),
    ...endpoints.map((url, index) => new OpenAiCompatibleProvider(`openai-compatible-${index + 1}`, url))
  ]);
}

const remoteProfilesKey = 'localforge.remoteProfiles';

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

  const profiles = context.globalState.get<RemoteGpuProfile[]>(remoteProfilesKey, []);
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
  await context.globalState.update(remoteProfilesKey, [...profiles.filter((item) => item.id !== profile.id), profile]);
  await context.secrets.store(remoteSecretKey(profile.id), JSON.stringify({ secret }));
  void vscode.window.showInformationMessage(`Saved remote profile “${profile.name}”. Secrets are stored in VS Code SecretStorage.`);
}

async function connectRemote(
  context: vscode.ExtensionContext,
  provider: CompositeProvider,
  viewProvider: LocalForgeViewProvider,
  setSession: (session: { tunnel: SshOllamaTunnel; providerId: string; profileName: string } | undefined) => void
): Promise<void> {
  let profiles = context.globalState.get<RemoteGpuProfile[]>(remoteProfilesKey, []);
  if (!profiles.length) {
    const create = await vscode.window.showInformationMessage('No remote GPU profiles configured yet. Create one now?', 'Configure GPU Host', 'Cancel');
    if (create === 'Configure GPU Host') {
      await configureRemoteProfile(context);
      profiles = context.globalState.get<RemoteGpuProfile[]>(remoteProfilesKey, []);
    }
    if (!profiles.length) return;
  }
  const selected = await vscode.window.showQuickPick(profiles.map((profile) => ({ label: profile.name, description: `${profile.username}@${profile.host}:${profile.port}`, profile })), {
    title: 'Connect to remote GPU host'
  });
  if (!selected) return;
  const profile = selected.profile;
  const stored = await context.secrets.get(remoteSecretKey(profile.id));
  const credential = stored ? JSON.parse(stored) as { secret?: string } : {};
  const verifyUnknownHost = async (fingerprint: string): Promise<boolean> => {
    const choice = await vscode.window.showWarningMessage(
      `First connection to ${profile.host}. Verify this SSH host fingerprint with the server administrator before trusting it:\nSHA-256 (hex): ${fingerprint}`,
      { modal: true },
      'Trust and save fingerprint'
    );
    if (choice !== 'Trust and save fingerprint') return false;
    profile.hostFingerprint = fingerprint;
    const latest = context.globalState.get<RemoteGpuProfile[]>(remoteProfilesKey, []);
    await context.globalState.update(remoteProfilesKey, latest.map((item) => item.id === profile.id ? profile : item));
    return true;
  };

  try {
    const tunnel = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Connecting to ${profile.name} (SSH tunnel)` }, async () => {
      const options = profile.authenticationMethod === 'password'
        ? { password: credential.secret, verifyUnknownHost }
        : { privateKey: await readPrivateKey(profile.privateKeyPath ?? ''), passphrase: credential.secret || undefined, verifyUnknownHost };
      return SshOllamaTunnel.open(profile, options);
    });
    const providerId = `ssh-ollama-${profile.id}`;
    provider.addProvider(new OllamaProvider(`http://127.0.0.1:${tunnel.port}`, providerId));
    const session = { tunnel, providerId, profileName: profile.name };
    setSession(session);
    await viewProvider.refresh();
    void vscode.window.showInformationMessage(`SSH tunnel to ${profile.name} is active. Heavy models run remotely on your GPU!`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Remote GPU connection failed: ${errorMessage(error)}`);
  }
}

function remoteSecretKey(id: string): string {
  return `localforge.remote.${id}.credential`;
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? undefined : 'Enter a port from 1 to 65535.';
}

async function searchWorkspace(): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Workspace search requires a trusted workspace.');
    return;
  }
  const query = await vscode.window.showInputBox({ title: 'LocalForge: Search workspace', prompt: 'Find files and code related to a question or symbol' });
  if (!query?.trim()) return;
  try {
    const snippets = await findRelevantSnippets(query, { maxFiles: 12, maxChars: 20000 });
    if (!snippets.length) {
      void vscode.window.showInformationMessage('No matching workspace code was found.');
      return;
    }
    const selected = await vscode.window.showQuickPick(snippets.map((snippet) => ({
      label: `${snippet.path}:${snippet.startLine}`,
      description: snippet.text.replace(/\s+/g, ' ').slice(0, 140),
      snippet
    })), { title: 'LocalForge workspace matches' });
    if (!selected) return;
    const document = await vscode.workspace.openTextDocument(selected.snippet.uri);
    const editor = await vscode.window.showTextDocument(document);
    const line = Math.max(0, selected.snippet.startLine - 1);
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    void vscode.window.showErrorMessage(`Workspace search failed: ${errorMessage(error)}`);
  }
}

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

async function explainSelection(viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file and select code for LocalForge to explain.');
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
  await vscode.commands.executeCommand('localforge.chatView.focus');
  const relPath = vscode.workspace.asRelativePath(editor.document.uri);
  const prompt = formatExplainPrompt(original, editor.document.languageId, relPath);
  await viewProvider.sendUserPrompt(prompt, { includeContext: false, mode: 'ask' });
}

async function fixSelection(provider: ModelProvider, viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file before asking LocalForge to fix code.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('LocalForge code fixes require a trusted workspace.');
    return;
  }

  const documentVersion = editor.document.version;
  const targetRange = editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).range
    : editor.selection;
  const original = editor.document.getText(targetRange);
  if (!original.trim()) {
    void vscode.window.showInformationMessage('Select code or place the cursor on code you want LocalForge to fix.');
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
    title: 'LocalForge: Fix code',
    prompt: diagnosticMessages.length
      ? `Found ${diagnosticMessages.length} issue(s) at selection. Describe the fix or press Enter to address diagnostics.`
      : 'Describe what to fix in the selected code.',
    value: defaultPrompt,
    ignoreFocusOut: true
  });
  if (instruction === undefined) return;

  let model = viewProvider.modelForTask('edit');
  if (!model) {
    try {
      model = (await provider.listModels())[0]?.name;
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not find a model: ${errorMessage(error)}`);
      return;
    }
  }
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
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LocalForge is generating a fix', cancellable: true }, async (progress, token) => {
      const cancellation = token.onCancellationRequested(() => controller.abort());
      try {
        await provider.streamChat(model!, messages, (chunk) => {
          replacement += chunk;
          progress.report({ message: `${replacement.length.toLocaleString()} characters` });
        }, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        cancellation.dispose();
      }
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Fix generation failed: ${errorMessage(error)}`);
    return;
  }
  if (!replacement.trim() || controller.signal.aborted) return;
  replacement = cleanModelCodeOutput(replacement);

  const originalDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: original });
  const proposedDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: replacement });
  await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, proposedDoc.uri, 'LocalForge: Review proposed fix');
  const choice = await vscode.window.showInformationMessage('Review the diff. Apply this fix to the original file?', 'Apply', 'Discard');
  if (choice !== 'Apply') return;
  if (editor.document.isClosed || editor.document.version !== documentVersion) {
    void vscode.window.showWarningMessage('The source file changed while the proposal was open. Re-run the fix so the diff is based on current content.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, targetRange, replacement);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) void vscode.window.showInformationMessage('LocalForge applied the reviewed fix.');
}

async function proposeEdit(provider: ModelProvider, viewProvider: LocalForgeViewProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('Open a file before asking LocalForge to edit code.');
    return;
  }
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('LocalForge edits require a trusted workspace.');
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

  let model = viewProvider.modelForTask('edit');
  if (!model) {
    try {
      model = (await provider.listModels())[0]?.name;
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not find a model: ${errorMessage(error)}`);
      return;
    }
  }
  if (!model) {
    void vscode.window.showWarningMessage('No local model is available. Start Ollama and install a model first.');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    title: 'LocalForge: Edit code',
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
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'LocalForge is preparing an edit', cancellable: true }, async (progress, token) => {
      const cancellation = token.onCancellationRequested(() => controller.abort());
      try {
        await provider.streamChat(model!, messages, (chunk) => {
          replacement += chunk;
          progress.report({ message: `${replacement.length.toLocaleString()} characters` });
        }, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        cancellation.dispose();
      }
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Edit generation failed: ${errorMessage(error)}`);
    return;
  }
  if (!replacement.trim() || controller.signal.aborted) return;
  replacement = cleanModelCodeOutput(replacement);

  const originalDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: original });
  const proposedDoc = await vscode.workspace.openTextDocument({ language: editor.document.languageId, content: replacement });
  await vscode.commands.executeCommand('vscode.diff', originalDoc.uri, proposedDoc.uri, 'LocalForge: Review proposed edit');
  const choice = await vscode.window.showInformationMessage('Review the diff. Apply this edit to the original file?', 'Apply', 'Discard');
  if (choice !== 'Apply') return;
  if (editor.document.isClosed || editor.document.version !== documentVersion) {
    void vscode.window.showWarningMessage('The source file changed while the proposal was open. Re-run the edit so the diff is based on current content.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, targetRange, replacement);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) void vscode.window.showInformationMessage('LocalForge applied the reviewed edit.');
}

class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private readonly conversations = new Map<string, ChatMessage[]>();
  private busy = false;
  private activeChat?: AbortController;
  private remoteSession?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string };
  selectedModel?: string;
  activeMode: AgentMode = 'agent';

  modelForTask(task: ModelTask): string | undefined {
    const configuration = vscode.workspace.getConfiguration('localforge.routing');
    const preferences: Record<ModelTask, string> = {
      chat: configuration.get<string>('chatModel', ''),
      edit: configuration.get<string>('editModel', ''),
      agent: configuration.get<string>('agentModel', ''),
      completion: configuration.get<string>('completionModel', '')
    };
    return routeModel(this.models, task, preferences, this.selectedModel)?.name;
  }

  constructor(private readonly provider: ModelProvider, private readonly context: vscode.ExtensionContext) {
    const saved = this.context.workspaceState.get<Record<string, ChatMessage[]>>('localforge.conversations', {});
    if (saved && typeof saved === 'object') {
      for (const [key, msgs] of Object.entries(saved)) {
        if (Array.isArray(msgs)) {
          this.conversations.set(key, msgs.filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string'));
        }
      }
    }
  }

  setRemoteSession(session?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string }): void {
    this.remoteSession = session;
    void this.postRemoteStatus();
  }

  async postRemoteStatus(): Promise<void> {
    if (!this.remoteSession) {
      this.post({ type: 'remoteStatus', connected: false });
      return;
    }
    let gpuInfo = '';
    try {
      gpuInfo = await this.remoteSession.tunnel.getGpuStatus();
    } catch {
      gpuInfo = 'Connected via SSH tunnel';
    }
    this.post({
      type: 'remoteStatus',
      connected: true,
      profileName: this.remoteSession.profileName,
      gpuInfo
    });
  }

  postActiveEditor(relPath: string): void {
    this.post({ type: 'activeEditor', path: relPath });
  }

  private saveConversations(): void {
    const obj: Record<string, ChatMessage[]> = {};
    for (const [key, value] of this.conversations.entries()) {
      obj[key] = value.slice(-40).map((m) => ({ role: m.role, content: m.content }));
    }
    void this.context.workspaceState.update('localforge.conversations', obj);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (!isWebviewMessage(message)) return;

      if (message.type === 'ready' || message.type === 'refresh') {
        if (this.models.length > 0) {
          this.post({ type: 'models', models: this.models, selectedModel: this.selectedModel });
          const history = this.conversations.get(this.selectedModel ?? '') ?? [];
          this.post({ type: 'history', messages: history });
          this.post({
            type: 'status',
            state: 'ready',
            message: `Connected to ${[...new Set(this.models.map((model) => model.providerId))].join(', ')} · ${this.models.length} model${this.models.length === 1 ? '' : 's'} available`
          });
        }
        await this.postRemoteStatus();
        if (vscode.window.activeTextEditor) {
          this.postActiveEditor(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri));
        }
        await this.refresh();
        const history = this.conversations.get(this.selectedModel ?? '') ?? [];
        this.post({ type: 'history', messages: history });
      }

      if (message.type === 'setMode') {
        this.activeMode = message.mode;
      }

      if (message.type === 'getRemoteStatus') {
        await this.postRemoteStatus();
      }

      if (message.type === 'connectRemote') {
        await vscode.commands.executeCommand('localforge.connectRemote');
      }

      if (message.type === 'disconnectRemote') {
        await vscode.commands.executeCommand('localforge.disconnectRemote');
      }

      if (message.type === 'configureRemote') {
        await vscode.commands.executeCommand('localforge.configureRemote');
      }

      if (message.type === 'openFile') {
        try {
          const roots = vscode.workspace.workspaceFolders;
          if (roots?.length) {
            const uri = vscode.Uri.joinPath(roots[0].uri, message.path);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
          }
        } catch {}
      }

      if (message.type === 'cancel') this.activeChat?.abort();

      if (message.type === 'clear') {
        if (this.selectedModel) {
          this.conversations.delete(this.selectedModel);
          this.saveConversations();
        }
        this.post({ type: 'history', messages: [] });
      }

      if (message.type === 'selectModel') {
        this.selectedModel = this.models.some((model) => model.name === message.model) ? message.model : undefined;
        const history = this.conversations.get(this.selectedModel ?? '') ?? [];
        this.post({ type: 'history', messages: history });
      }

      if (message.type === 'chat') void this.chat(message);
    });

    view.webview.html = getHtml(view.webview);
  }

  async sendUserPrompt(promptText: string, options: { includeContext?: boolean; includeWorkspace?: boolean; mode?: AgentMode } = {}): Promise<void> {
    if (!this.models.length) {
      await this.refresh();
    }
    if (!this.selectedModel && this.models.length) {
      this.selectedModel = this.models[0].name;
    }
    const model = this.selectedModel;
    if (!model) {
      void vscode.window.showWarningMessage('No local model is available. Start Ollama and refresh.');
      return;
    }
    await this.chat({
      type: 'chat',
      model,
      prompt: promptText,
      mode: options.mode ?? this.activeMode,
      includeContext: options.includeContext ?? false,
      includeWorkspace: options.includeWorkspace ?? false
    });
  }

  async refresh(): Promise<void> {
    this.post({ type: 'status', state: 'checking', message: 'Looking for local and remote models…' });
    try {
      const detected = await this.provider.detect();
      if (!detected) {
        this.models = [];
        this.post({ type: 'models', models: [] });
        this.post({ type: 'status', state: 'offline', message: 'No configured local or remote model server is responding. Start Ollama or connect Remote GPU, then refresh.' });
        return;
      }

      this.models = await this.provider.listModels();
      const routing = vscode.workspace.getConfiguration('localforge.routing');
      const chatPreferences = {
        chat: routing.get<string>('chatModel', ''),
        edit: routing.get<string>('editModel', ''),
        agent: routing.get<string>('agentModel', ''),
        completion: routing.get<string>('completionModel', '')
      };
      this.selectedModel = this.models.some((model) => model.name === this.selectedModel)
        ? this.selectedModel
        : routeModel(this.models, 'chat', chatPreferences)?.name;
      this.post({ type: 'models', models: this.models, selectedModel: this.selectedModel });
      const history = this.conversations.get(this.selectedModel ?? '') ?? [];
      this.post({ type: 'history', messages: history });
      this.post({
        type: 'status',
        state: this.models.length ? 'ready' : 'empty',
        message: this.models.length
          ? `Connected to ${[...new Set(this.models.map((model) => model.providerId))].join(', ')} · ${this.models.length} model${this.models.length === 1 ? '' : 's'} available`
          : 'Server is reachable, but reports no installed models. Run `ollama pull <model>` or connect Remote GPU, then refresh.'
      });
    } catch (error) {
      this.post({ type: 'status', state: 'error', message: errorMessage(error) });
    }
  }

  private async chat(request: Extract<WebviewMessage, { type: 'chat' }>): Promise<void> {
    if (this.busy) return;
    const mode: AgentMode = request.mode ?? (request.agentMode ? 'agent' : 'ask');

    if (mode === 'agent' && !vscode.workspace.isTrusted) {
      this.post({ type: 'error', message: 'Agent mode requires a trusted workspace because it can read, edit files and run commands.' });
      return;
    }
    const routedModel = mode === 'agent' ? this.modelForTask('agent') : undefined;
    const model = this.models.find((item) => item.name === (routedModel ?? request.model));
    if (!model) {
      this.post({ type: 'error', message: 'Choose an available model before sending a message.' });
      return;
    }
    const prompt = request.prompt.trim();
    if (!prompt) return;

    this.busy = true;
    const controller = new AbortController();
    this.activeChat = controller;
    const messages = this.conversations.get(model.name) ?? [];
    let userContent = prompt;
    if (request.includeContext) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.document.getText(editor.selection).trim();
        const text = selection || editor.document.getText();
        if (text) {
          const label = selection ? 'Selected code' : 'Current file';
          userContent += `\n\n${label} (${vscode.workspace.asRelativePath(editor.document.uri)}):\n\`\`\`\n${text.slice(0, 20000)}\n\`\`\``;
        }
      }
    }
    if (request.includeWorkspace && vscode.workspace.isTrusted) {
      try {
        const snippets = await findRelevantSnippets(prompt, {}, vscode.window.activeTextEditor?.document.uri);
        if (snippets.length) {
          userContent += '\n\nRelevant workspace context (retrieved locally):\n' + snippets.map((snippet) =>
            `\n${snippet.path}:${snippet.startLine}\n${snippet.text}`
          ).join('\n');
        }
      } catch (error) {
        this.post({ type: 'status', state: 'error', message: `Workspace context unavailable: ${errorMessage(error)}` });
      }
    }

    messages.push({ role: 'user', content: userContent });
    this.post({ type: 'userMessage', content: prompt, mode });
    this.post({ type: 'assistantStart', mode });
    let answer = '';
    try {
      if (mode === 'agent' || mode === 'plan') {
        const tools = mode === 'agent' ? allWorkspaceTools : readOnlyWorkspaceTools;
        answer = await runToolAgent(
          this.provider,
          model.name,
          messages,
          tools,
          executeWorkspaceTool,
          {
            signal: controller.signal,
            mode,
            onThought: (thought) => {
              this.post({ type: 'thought', content: thought });
            },
            onToolStart: (name, args, id) => {
              this.post({ type: 'toolStart', id, name, args });
            },
            onToolEnd: (name, result, error, id) => {
              this.post({ type: 'toolEnd', id, name, result, error });
            },
            onTool: (message) => {
              this.post({ type: 'toolStatus', content: message });
            }
          }
        );
        this.post({ type: 'token', content: answer });
      } else {
        await this.provider.streamChat(model.name, messages, (token) => {
          answer += token;
          this.post({ type: 'token', content: token });
        }, controller.signal);
      }
      messages.push({ role: 'assistant', content: answer });
      this.conversations.set(model.name, messages.slice(-40));
      this.saveConversations();
      this.post({ type: 'assistantDone' });
    } catch (error) {
      messages.pop();
      if (!controller.signal.aborted) this.post({ type: 'error', message: errorMessage(error) });
      else this.post({ type: 'status', state: 'ready', message: 'Task cancelled.' });
      this.post({ type: 'assistantDone' });
    } finally {
      this.busy = false;
      if (this.activeChat === controller) this.activeChat = undefined;
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isWebviewMessage(value: unknown): value is WebviewMessage {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === 'ready' || message.type === 'refresh' || message.type === 'cancel' || message.type === 'clear'
    || message.type === 'connectRemote' || message.type === 'disconnectRemote' || message.type === 'configureRemote' || message.type === 'getRemoteStatus') {
    return true;
  }
  if (message.type === 'openFile') return typeof message.path === 'string';
  if (message.type === 'selectModel') return typeof message.model === 'string' && message.model.length <= 200;
  if (message.type === 'setMode') return message.mode === 'ask' || message.mode === 'plan' || message.mode === 'agent';
  if (message.type === 'chat') {
    return typeof message.model === 'string'
      && message.model.length <= 200
      && typeof message.prompt === 'string'
      && message.prompt.length <= 20000
      && typeof message.includeContext === 'boolean'
      && typeof message.includeWorkspace === 'boolean'
      && (message.mode === 'ask' || message.mode === 'plan' || message.mode === 'agent' || typeof message.agentMode === 'boolean');
  }
  return false;
}

function getHtml(webview: vscode.Webview): string {
  const nonce = randomBytes(16).toString('hex');
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${cspSource} 'unsafe-inline';">
  <style>
    :root {
      color-scheme: light dark;
      --agent-accent: #0284c7;
      --agent-accent-glow: rgba(2, 132, 199, 0.15);
      --plan-accent: #d97706;
      --plan-accent-glow: rgba(217, 119, 6, 0.15);
      --ask-accent: #059669;
      --ask-accent-glow: rgba(5, 150, 105, 0.15);
      --active-theme-accent: var(--agent-accent);
      --active-theme-glow: var(--agent-accent-glow);
    }
    body {
      padding: 10px;
      margin: 0;
      color: var(--vscode-foreground);
      font: 13px/1.5 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      overflow: hidden;
    }

    /* Mode Pill Bar */
    .mode-bar {
      display: flex;
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.15));
      padding: 3px;
      border-radius: 8px;
      gap: 3px;
      margin-bottom: 8px;
    }
    .mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 6px 4px;
      font-size: 11.5px;
      font-weight: 600;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      transition: all 0.15s ease;
    }
    .mode-btn:hover {
      color: var(--vscode-foreground);
      background: rgba(128,128,128,0.1);
    }
    .mode-btn.active[data-mode="agent"] {
      background: #0284c7;
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(2,132,199,0.3);
    }
    .mode-btn.active[data-mode="plan"] {
      background: #d97706;
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(217,119,6,0.3);
    }
    .mode-btn.active[data-mode="ask"] {
      background: #059669;
      color: #ffffff;
      box-shadow: 0 1px 4px rgba(5,150,105,0.3);
    }

    /* Utility Row */
    .utility-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .remote-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 6px;
      background: var(--vscode-badge-background, rgba(128,128,128,0.2));
      color: var(--vscode-badge-foreground, inherit);
      font-size: 11px;
      border: 1px solid var(--vscode-widget-border, transparent);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .remote-chip:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
    }
    .remote-chip.connected {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.15);
      color: #10b981;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
      display: inline-block;
    }
    .dot.online { background: #10b981; box-shadow: 0 0 6px #10b981; }

    select {
      flex: 1;
      min-width: 0;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 5px 7px;
      font: inherit;
      font-size: 12px;
    }
    .icon-btn {
      cursor: pointer;
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
      color: var(--vscode-button-secondaryForeground, inherit);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
    }
    .icon-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
    }

    /* Status Banner */
    #status {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      padding: 3px 2px 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
    }
    #status[data-state="offline"], #status[data-state="error"] { color: var(--vscode-errorForeground); }

    /* Messages / Stream Container */
    #messages {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 10px 0;
      overflow-y: auto;
      min-height: 0;
    }

    /* Message Bubbles */
    .msg {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-radius: 8px;
      padding: 9px 12px;
      line-height: 1.5;
      font-size: 12.5px;
      overflow-wrap: anywhere;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.2));
      border-left: 3px solid var(--active-theme-accent);
      max-width: 90%;
    }
    .msg.assistant {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    }
    .msg-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Thought / Reasoning Accordion */
    .thought-card {
      margin: 4px 0 8px;
      border-radius: 6px;
      background: rgba(128,128,128,0.07);
      border: 1px dashed var(--vscode-panel-border, rgba(128,128,128,0.25));
      font-size: 11.5px;
    }
    .thought-card summary {
      padding: 6px 10px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      user-select: none;
    }
    .thought-content {
      padding: 6px 10px 8px;
      white-space: pre-wrap;
      color: var(--vscode-foreground);
      opacity: 0.85;
      line-height: 1.45;
    }

    /* Tool Action Cards */
    .tool-card {
      margin: 4px 0;
      border-radius: 6px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      overflow: hidden;
      font-size: 11.5px;
    }
    .tool-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: rgba(128,128,128,0.08);
      cursor: pointer;
      user-select: none;
    }
    .tool-icon { font-size: 12px; }
    .tool-name { font-weight: 600; font-family: var(--vscode-editor-font-family, monospace); }
    .tool-param { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
    .tool-status { font-size: 11px; }
    .tool-status.running { color: #38bdf8; animation: pulse 1.5s infinite; }
    .tool-status.done { color: #10b981; }
    .tool-status.error { color: var(--vscode-errorForeground); }
    .tool-details {
      padding: 8px 10px;
      max-height: 200px;
      overflow-y: auto;
      background: rgba(0,0,0,0.15);
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      white-space: pre-wrap;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Markdown & Code Blocks */
    .code-container {
      margin: 8px 0;
      border-radius: 6px;
      overflow: hidden;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
      white-space: normal;
    }
    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: rgba(128,128,128,0.1);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-family: sans-serif;
    }
    .copy-code-btn {
      padding: 2px 6px;
      font-size: 10px;
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
      color: var(--vscode-button-secondaryForeground, inherit);
      border: 0;
      cursor: pointer;
    }
    .copy-code-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
    pre { margin: 0; padding: 8px; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
    code { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; background: rgba(128,128,128,0.15); padding: 1px 4px; border-radius: 3px; }
    .code-container code { background: none; padding: 0; }
    ul { margin: 6px 0; padding-left: 18px; }
    li { margin: 3px 0; }
    input[type="checkbox"] { margin-right: 6px; vertical-align: middle; cursor: pointer; }

    /* Composer Bottom Area */
    .composer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.15));
      padding-top: 8px;
      background: var(--vscode-sideBar-background);
    }
    .context-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-wrap: wrap;
    }
    .context-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(128,128,128,0.12);
      border: 1px solid var(--vscode-widget-border, transparent);
      cursor: default;
    }
    .context-pill.file { color: var(--vscode-textLink-foreground); cursor: pointer; }
    label { display: flex; align-items: center; gap: 4px; cursor: pointer; }

    textarea {
      box-sizing: border-box;
      width: 100%;
      min-height: 68px;
      max-height: 160px;
      resize: vertical;
      color: inherit;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      font-size: 12.5px;
    }
    textarea:focus {
      outline: 1px solid var(--active-theme-accent);
      border-color: var(--active-theme-accent);
    }

    .composer-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .submit-btn {
      flex: 1;
      padding: 7px 12px;
      border: 0;
      border-radius: 6px;
      background: var(--active-theme-accent);
      color: #ffffff;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: filter 0.15s ease;
    }
    .submit-btn:hover { filter: brightness(1.1); }
    .submit-btn:disabled { opacity: 0.5; cursor: default; }

    .cancel-btn {
      padding: 7px 12px;
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
      border-radius: 6px;
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
      color: var(--vscode-button-secondaryForeground, inherit);
      font-size: 12px;
      cursor: pointer;
    }
    .cancel-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3)); }
    .cancel-btn:disabled { opacity: 0.4; cursor: default; }
  </style>
</head>
<body>
  <!-- Mode Selector Bar -->
  <div class="mode-bar">
    <button class="mode-btn active" data-mode="agent">⚡ Agent</button>
    <button class="mode-btn" data-mode="plan">📋 Plan</button>
    <button class="mode-btn" data-mode="ask">💬 Ask</button>
  </div>

  <!-- Utility / Remote GPU Bar -->
  <div class="utility-bar">
    <button id="remoteBtn" class="remote-chip" title="Connect to Remote GPU host (SSH Tunnel)">
      <span class="dot" id="remoteDot"></span>
      <span id="remoteText">🖥️ Remote GPU</span>
    </button>
    <select id="model" aria-label="Selected Model"><option value="">Discovering models…</option></select>
    <button id="refresh" class="icon-btn" title="Refresh models">↻</button>
    <button id="clear" class="icon-btn" title="Clear conversation">⌫</button>
  </div>

  <!-- Status / Mode Info -->
  <div id="status" role="status">Connecting to local and remote models…</div>

  <!-- Messages & Tool Timeline -->
  <div id="messages" aria-live="polite"></div>

  <!-- Composer Area -->
  <div class="composer">
    <div class="context-row">
      <span id="activeFileChip" class="context-pill file" style="display:none;" title="Current open file">📄 <span id="activeFileName"></span></span>
      <label><input id="context" type="checkbox" checked> Active editor context</label>
      <label><input id="workspaceContext" type="checkbox"> Search workspace</label>
    </div>
    <textarea id="prompt" placeholder="Ask LocalForge to build, inspect, edit or automate code…" aria-label="Task prompt"></textarea>
    <div class="composer-actions">
      <button id="send" class="submit-btn">⚡ Run Agent</button>
      <button id="cancel" class="cancel-btn" disabled>⏹ Stop</button>
    </div>
  </div>

  <script nonce="${nonce}">
    try {
      const vscode = acquireVsCodeApi();
      let currentMode = 'agent';
      let activeAssistantCard = null;
      let activeThoughtBox = null;
      let toolCards = new Map();

      const modelSelect = document.getElementById('model');
      const status = document.getElementById('status');
      const messages = document.getElementById('messages');
      const prompt = document.getElementById('prompt');
      const send = document.getElementById('send');
      const cancel = document.getElementById('cancel');
      const clear = document.getElementById('clear');
      const refresh = document.getElementById('refresh');
      const remoteBtn = document.getElementById('remoteBtn');
      const remoteDot = document.getElementById('remoteDot');
      const remoteText = document.getElementById('remoteText');
      const activeFileChip = document.getElementById('activeFileChip');
      const activeFileName = document.getElementById('activeFileName');

      // Mode Switcher
      document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentMode = btn.dataset.mode;
          updateModeTheme(currentMode);
          vscode.postMessage({ type: 'setMode', mode: currentMode });
        });
      });

      function updateModeTheme(mode) {
        if (mode === 'agent') {
          document.documentElement.style.setProperty('--active-theme-accent', 'var(--agent-accent)');
          send.innerHTML = '⚡ Run Agent';
          prompt.placeholder = 'Ask LocalForge to inspect, write, edit files, or run commands…';
        } else if (mode === 'plan') {
          document.documentElement.style.setProperty('--active-theme-accent', 'var(--plan-accent)');
          send.innerHTML = '📋 Generate Plan';
          prompt.placeholder = 'Describe a feature or refactoring task to architect and plan…';
        } else {
          document.documentElement.style.setProperty('--active-theme-accent', 'var(--ask-accent)');
          send.innerHTML = '💬 Ask';
          prompt.placeholder = 'Ask questions about this code or search the workspace…';
        }
      }

      // Remote GPU Click
      remoteBtn.addEventListener('click', () => {
        if (remoteBtn.dataset.connected === 'true') {
          vscode.postMessage({ type: 'disconnectRemote' });
        } else {
          vscode.postMessage({ type: 'connectRemote' });
        }
      });

      refresh.addEventListener('click', () => {
        status.textContent = 'Discovering models…';
        status.dataset.state = 'checking';
        vscode.postMessage({ type: 'refresh' });
      });

      clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
      modelSelect.addEventListener('change', () => vscode.postMessage({ type: 'selectModel', model: modelSelect.value }));
      send.addEventListener('click', submit);
      cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
      prompt.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          submit();
        }
      });

      function submit() {
        if (!prompt.value.trim() || !modelSelect.value || send.disabled) return;
        vscode.postMessage({
          type: 'chat',
          model: modelSelect.value,
          prompt: prompt.value,
          mode: currentMode,
          includeContext: document.getElementById('context').checked,
          includeWorkspace: document.getElementById('workspaceContext').checked
        });
        prompt.value = '';
      }

      function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }

      function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function formatMarkdown(text) {
        if (!text) return '';
        let completeText = text;
        const fence = String.fromCharCode(96, 96, 96);
        const fenceCount = completeText.split(fence).length - 1;
        if (fenceCount % 2 !== 0) {
          completeText += '\\n' + fence;
        }
        const codeBlocks = [];
        const codeBlockPattern = new RegExp(fence + '([a-zA-Z0-9_-]*)\\\\r?\\\\n([\\\\s\\\\S]*?)' + fence, 'g');
        let processed = completeText.replace(codeBlockPattern, (match, lang, code) => {
          const placeholder = '__CODE_BLOCK_' + codeBlocks.length + '__';
          codeBlocks.push({ lang: lang || 'code', code: code.replace(/\\r?\\n$/, '') });
          return placeholder;
        });

        processed = escapeHtml(processed);
        // Markdown headings
        processed = processed.replace(/^### (.*$)/gim, '<h4>$1</h4>');
        processed = processed.replace(/^## (.*$)/gim, '<h3>$1</h3>');
        processed = processed.replace(/^# (.*$)/gim, '<h2>$1</h2>');
        // Checkboxes in task lists
        processed = processed.replace(/^- \\[x\\] (.*$)/gim, '<li><input type="checkbox" checked disabled> $1</li>');
        processed = processed.replace(/^- \\[ \\] (.*$)/gim, '<li><input type="checkbox" disabled> $1</li>');

        const inlinePattern = new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + '\\\\n]+)' + String.fromCharCode(96), 'g');
        processed = processed.replace(inlinePattern, (m, c) => '<code>' + c + '</code>');
        processed = processed.replace(/\\*\\*([^\\*\\n]+)\\*\\*/g, '<strong>$1</strong>');
        processed = processed.replace(/(^|[^*])\\*([^*\\n]+)\\*([^*]|$)/g, '$1<em>$2</em>$3');
        processed = processed.replace(/^[\\t ]*[-*] (.+)$/gm, '<li>$1</li>');
        processed = processed.replace(/(<li>[\\s\\S]*?<\\/li>)/g, '<ul>$1</ul>');
        processed = processed.replace(/<\\/ul>\\s*<ul>/g, '');
        processed = processed.replace(/\\r?\\n/g, '<br>');

        for (let i = 0; i < codeBlocks.length; i++) {
          const item = codeBlocks[i];
          const escapedCode = escapeHtml(item.code);
          const attrCode = escapeAttr(item.code);
          const blockHtml = '<div class="code-container"><div class="code-header"><span>' + escapeHtml(item.lang) + '</span><button class="copy-code-btn" data-code="' + attrCode + '">Copy</button></div><pre><code>' + escapedCode + '</code></pre></div>';
          processed = processed.replace('__CODE_BLOCK_' + i + '__', blockHtml);
        }

        return processed;
      }

      function addUserMessage(content) {
        const item = document.createElement('div');
        item.className = 'msg user';
        item.innerHTML = '<div class="msg-header">You</div><div>' + formatMarkdown(content) + '</div>';
        messages.appendChild(item);
        messages.scrollTop = messages.scrollHeight;
      }

      function startAssistantMessage(mode) {
        const item = document.createElement('div');
        item.className = 'msg assistant';
        const label = mode === 'agent' ? '⚡ LocalForge Copilot Agent' : (mode === 'plan' ? '📋 Architecture Plan' : '💬 LocalForge');
        item.innerHTML = '<div class="msg-header">' + label + '</div><div class="assistant-body"></div>';
        messages.appendChild(item);
        activeAssistantCard = item.querySelector('.assistant-body');
        activeThoughtBox = null;
        toolCards.clear();
        messages.scrollTop = messages.scrollHeight;
        send.disabled = true;
        cancel.disabled = false;
      }

      // Clipboard copy handler
      messages.addEventListener('click', (event) => {
        const target = event.target;
        if (target && target.classList.contains('copy-code-btn')) {
          const code = target.getAttribute('data-code');
          if (code !== null) {
            navigator.clipboard.writeText(code).then(() => {
              const original = target.textContent;
              target.textContent = 'Copied!';
              setTimeout(() => { target.textContent = original; }, 1500);
            }).catch(() => {});
          }
        }
      });

      // Window Message Listener
      window.addEventListener('message', event => {
        const data = event.data;

        if (data.type === 'status') {
          status.textContent = data.message;
          status.dataset.state = data.state;
        }

        if (data.type === 'remoteStatus') {
          if (data.connected) {
            remoteBtn.classList.add('connected');
            remoteBtn.dataset.connected = 'true';
            remoteDot.className = 'dot online';
            remoteText.textContent = '🟢 ' + (data.profileName || 'Remote GPU');
            remoteBtn.title = (data.gpuInfo || 'Connected via SSH tunnel') + '\\nClick to disconnect';
          } else {
            remoteBtn.classList.remove('connected');
            remoteBtn.dataset.connected = 'false';
            remoteDot.className = 'dot';
            remoteText.textContent = '🖥️ Remote GPU';
            remoteBtn.title = 'Click to connect Remote GPU host over SSH';
          }
        }

        if (data.type === 'activeEditor') {
          if (data.path) {
            activeFileChip.style.display = 'inline-flex';
            activeFileName.textContent = data.path.split('/').pop() || data.path;
            activeFileChip.title = data.path;
          } else {
            activeFileChip.style.display = 'none';
          }
        }

        if (data.type === 'models') {
          const previous = modelSelect.value;
          modelSelect.replaceChildren();
          if (!data.models.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No models found';
            modelSelect.appendChild(option);
          }
          for (const model of data.models) {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.displayName || model.name;
            modelSelect.appendChild(option);
          }
          if (data.models.some(model => model.name === data.selectedModel)) modelSelect.value = data.selectedModel;
          else if (data.models.some(model => model.name === previous)) modelSelect.value = previous;
        }

        if (data.type === 'history') {
          messages.replaceChildren();
          if (Array.isArray(data.messages)) {
            for (const msg of data.messages) {
              if (msg.role === 'user') addUserMessage(msg.content);
              else if (msg.role === 'assistant') {
                const item = document.createElement('div');
                item.className = 'msg assistant';
                item.innerHTML = '<div class="msg-header">LocalForge</div><div class="assistant-body">' + formatMarkdown(msg.content) + '</div>';
                messages.appendChild(item);
              }
            }
          }
          messages.scrollTop = messages.scrollHeight;
        }

        if (data.type === 'userMessage') {
          addUserMessage(data.content);
        }

        if (data.type === 'assistantStart') {
          startAssistantMessage(data.mode);
        }

        if (data.type === 'thought' && activeAssistantCard) {
          if (!activeThoughtBox) {
            const details = document.createElement('details');
            details.className = 'thought-card';
            details.open = true;
            details.innerHTML = '<summary>💭 Agent Reasoning</summary><div class="thought-content"></div>';
            activeAssistantCard.appendChild(details);
            activeThoughtBox = details.querySelector('.thought-content');
          }
          activeThoughtBox.textContent = data.content;
          messages.scrollTop = messages.scrollHeight;
        }

        if (data.type === 'toolStart' && activeAssistantCard) {
          const id = data.id || ('tool-' + Date.now());
          const card = document.createElement('div');
          card.className = 'tool-card';
          card.id = id;

          let icon = '🔧';
          let param = '';
          if (data.name === 'search_workspace') { icon = '🔍'; param = data.args?.query || ''; }
          else if (data.name === 'read_workspace_file') { icon = '📖'; param = data.args?.path || ''; }
          else if (data.name === 'list_directory') { icon = '📁'; param = data.args?.path || 'root'; }
          else if (data.name === 'write_workspace_file') { icon = '📝'; param = data.args?.path || ''; }
          else if (data.name === 'edit_workspace_file') { icon = '✏️'; param = data.args?.path || ''; }
          else if (data.name === 'run_command') { icon = '⚡'; param = data.args?.command || ''; }

          card.innerHTML = '<div class="tool-header">'
            + '<span class="tool-icon">' + icon + '</span>'
            + '<span class="tool-name">' + escapeHtml(data.name) + '</span>'
            + '<span class="tool-param">' + escapeHtml(param) + '</span>'
            + '<span class="tool-status running">⏳ running</span>'
            + '</div>'
            + '<div class="tool-details" style="display:none;">' + escapeHtml(JSON.stringify(data.args, null, 2)) + '</div>';

          card.querySelector('.tool-header').addEventListener('click', () => {
            const det = card.querySelector('.tool-details');
            det.style.display = det.style.display === 'none' ? 'block' : 'none';
          });

          activeAssistantCard.appendChild(card);
          toolCards.set(id, card);
          messages.scrollTop = messages.scrollHeight;
        }

        if (data.type === 'toolEnd') {
          const card = toolCards.get(data.id);
          if (card) {
            const statusBadge = card.querySelector('.tool-status');
            const det = card.querySelector('.tool-details');
            if (data.error) {
              statusBadge.className = 'tool-status error';
              statusBadge.textContent = '✕ failed';
              det.textContent += '\\n\\nError: ' + data.error;
            } else {
              statusBadge.className = 'tool-status done';
              statusBadge.textContent = '✓ completed';
              det.textContent += '\\n\\nResult: ' + JSON.stringify(data.result, null, 2);
            }
          }
          messages.scrollTop = messages.scrollHeight;
        }

        if (data.type === 'token' && activeAssistantCard) {
          let textContainer = activeAssistantCard.querySelector('.text-content');
          if (!textContainer) {
            textContainer = document.createElement('div');
            textContainer.className = 'text-content';
            textContainer.dataset.raw = '';
            activeAssistantCard.appendChild(textContainer);
          }
          textContainer.dataset.raw += data.content;
          textContainer.innerHTML = formatMarkdown(textContainer.dataset.raw);
          messages.scrollTop = messages.scrollHeight;
        }

        if (data.type === 'assistantDone') {
          send.disabled = false;
          cancel.disabled = true;
          activeAssistantCard = null;
          activeThoughtBox = null;
        }

        if (data.type === 'error') {
          const item = document.createElement('div');
          item.className = 'msg assistant';
          item.innerHTML = '<div class="msg-header" style="color:var(--vscode-errorForeground)">Error</div><div>' + escapeHtml(data.message) + '</div>';
          messages.appendChild(item);
          messages.scrollTop = messages.scrollHeight;
        }
      });

      vscode.postMessage({ type: 'ready' });

      setTimeout(() => {
        if (modelSelect.options.length <= 1 && !modelSelect.value) {
          vscode.postMessage({ type: 'ready' });
        }
      }, 1200);
    } catch (err) {
      const status = document.getElementById('status');
      if (status) {
        status.textContent = 'Webview initialization error: ' + (err && err.message ? err.message : String(err));
        status.dataset.state = 'error';
      }
    }
  </script>
</body>
</html>`;
}

export function deactivate(): void {}
