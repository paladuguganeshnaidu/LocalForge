import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { ChatMessage, LocalModel, ModelProvider } from '../providers/modelProvider';
import { AgentMode } from '../agent/agentLoop';
import { SshOllamaTunnel } from '../remote/sshOllamaTunnel';
import { isWebviewMessage, WebviewMessage } from './webviewMessages';
import { LocalForgeEngine } from '../core/LocalForgeEngine';
import { ModelTask, routeModel } from '../providers/modelRouter';
import { EditProposal } from '../editing/editEngine';
import { Artifact } from '../core/artifactManager';
import { TurnActivity, ExecutionStrategy } from '../core/turnManager';
import { validateRelativeWorkspacePath } from '../agent/workspaceTools';
import { PermissionMode, PermissionRequest } from '../agent/permissionManager';
import { formatToolInput } from '../core/activityDetails';
import { renderChatMarkdown } from './chatMarkdown';
import { normalizeAssistantMarkdown } from '../core/responseFormatting';
import { SessionManager } from '../core/sessionManager';
import { classifyTaskIntent, conversationalMessages } from '../agent/taskIntent';
import { chatStyles } from './chatStyles';
import { canAttachWorkspaceContext } from '../context/accessBoundary';
import { defaultCompatibleEndpoints } from '../providers/endpointConfiguration';

export class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private sessionManager: SessionManager;
  private busy = false;
  private activeInteraction?: symbol;
  private activeChat?: AbortController;
  private remoteSession?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string };
  public selectedModel?: string;
  public activeMode: AgentMode = 'agent';
  public activeStrategy: ExecutionStrategy = 'planning';
  private engine?: LocalForgeEngine;
  private currentProposal?: EditProposal;
  private providerEvents?: vscode.Disposable;
  private pendingPermissionRequests = new Map<string, {
    resolve: (allowed: boolean) => void;
    request: PermissionRequest;
    activityId?: string;
    turnId?: string;
    abortCleanup?: () => void;
  }>();

  constructor(
    private readonly provider: ModelProvider,
    private readonly context: vscode.ExtensionContext,
    engine?: LocalForgeEngine
  ) {
    this.engine = engine;
    this.sessionManager = engine?.sessionManager ?? new SessionManager(context.workspaceState);
    if (this.engine) {
      this.initPermissionHandler();
    }
  }

  public setEngine(engine: LocalForgeEngine): void {
    this.engine = engine;
    this.sessionManager = engine.sessionManager;
    this.initPermissionHandler();
  }

  private initPermissionHandler(): void {
    if (!this.engine) return;
    this.providerEvents?.dispose();
    const engine = this.engine;
    const subagentProgress = (message: string) => {
      if (this.busy && engine.isBusy()) this.post({ type: 'status', state: 'running', message });
    };
    const changed = () => {
      this.postProviderStatus();
      if (!engine.getProviderConfigurationStatus().pending) void this.refresh();
    };
    const remoteDisconnected = (reason?: Error) => {
      this.setRemoteSession(undefined);
      if (reason) this.post({ type: 'controlError', message: reason.message });
    };
    engine.events?.on('providersChanged', changed);
    engine.events?.on('subagentProgress', subagentProgress);
    engine.events?.on('remoteDisconnected', remoteDisconnected);
    this.providerEvents = { dispose: () => { engine.events?.off('providersChanged', changed); engine.events?.off('subagentProgress', subagentProgress); engine.events?.off('remoteDisconnected', remoteDisconnected); } };
    this.context.subscriptions.push(this.providerEvents);
    this.engine.permissionManager.setApprovalHandler(async (request) => {
      if (request.signal?.aborted) return false;
      return new Promise<boolean>((resolve) => {
        const activity = this.recordPermissionRequest(request);
        const abort = () => this.resolvePermissionRequest(request.id, 'cancelled');
        this.pendingPermissionRequests.set(request.id, {
          resolve,
          request,
          activityId: activity?.activityId,
          turnId: activity?.turnId,
          abortCleanup: () => request.signal?.removeEventListener('abort', abort)
        });
        request.signal?.addEventListener('abort', abort, { once: true });
        if (request.signal?.aborted) {
          abort();
          return;
        }
        this.postPermissionRequest(request);
      });
    });
    if (this.engine.events) {
      const listener = () => this.postIndexStatus();
      this.engine.events.on('indexStatus', listener);
      const events = this.engine.events;
      this.context.subscriptions?.push({ dispose: () => events.off('indexStatus', listener) });
    }
  }

  private postIndexStatus(): void {
    this.post({ type: 'indexStatus', status: this.engine?.indexer?.getStats() ?? null, scope: this.engine?.accessPolicy.getState().scope ?? 'workspace' });
  }

  private postPermissionRequest(request: PermissionRequest): void {
    this.post({
      type: 'permissionRequest',
      request: {
        id: request.id,
        toolName: request.toolName,
        category: request.category,
        policy: request.policy,
        commandCategory: request.commandCategory,
        description: request.description,
        command: request.command,
        scriptPreview: request.args?.expandedScripts ? formatToolInput(request.toolName, { expandedScripts: request.args.expandedScripts }) : undefined,
        workspaceSessionAvailable: this.engine?.accessPolicy.getState().scope === 'workspace',
        path: request.path
      }
    });
  }

  private recordPermissionRequest(request: PermissionRequest): { turnId: string; activityId: string } | undefined {
    if (!this.engine) return undefined;
    const conversationId = this.engine.sessionManager.getActiveSession().id;
    const turn = this.engine.turnManager.getTurnsForConversation(conversationId).at(-1);
    if (!turn || !['running', 'waiting_for_approval'].includes(turn.status)) return undefined;

    const activity = this.engine.turnManager.addActivity(turn.turnId, {
      category: 'Waiting for approval',
      title: `Permission requested: ${request.toolName}`,
      details: 'Waiting for your decision.',
      toolName: request.toolName,
      targetPath: request.path,
      inputSummary: formatToolInput(request.toolName, request.args ?? {}),
      status: 'waiting_for_approval'
    });
    this.post({ type: 'activity', activity });
    return { turnId: turn.turnId, activityId: activity.id };
  }

  private resolvePermissionRequest(
    requestId: string,
    decision: 'allow' | 'deny' | 'allow_session' | 'cancelled'
  ): void {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) return;
    this.pendingPermissionRequests.delete(requestId);
    pending.abortCleanup?.();
    if (pending.request.signal?.aborted) decision = 'cancelled';
    if (decision === 'cancelled') this.post({ type: 'permissionCancelled', requestId });

    try {
      if (decision === 'allow_session') {
        this.setPermissionMode('ask_once_per_session');
        this.engine?.permissionManager.grantWorkspaceSession(this.engine.toolRegistry.getAllTools().filter(tool => tool.source === 'builtin').map(tool => tool.authorizationId));
        this.post({ type: 'permissionMode', mode: 'ask_once_per_session', workspaceSession: true });
      }
    } catch (error) {
      decision = 'deny';
      this.post({ type: 'error', message: error instanceof Error ? error.message : 'Could not grant workspace session access.' });
    }

    try {
    if (pending.activityId && pending.turnId && this.engine) {
      const turn = this.engine.turnManager.getTurn(pending.turnId);
      if (turn) {
        const allowed = decision === 'allow' || decision === 'allow_session';
        const status: TurnActivity['status'] = decision === 'cancelled' ? 'cancelled' : allowed ? 'success' : 'warning';
        const resolution = decision === 'allow_session' ? 'Approved for this session' :
          decision === 'allow' ? 'Approved for this action' :
            decision === 'deny' ? 'Denied by user' : 'Cancelled before approval';
        const activity = this.engine.turnManager.updateActivity(turn.turnId, pending.activityId, {
          title: `${resolution}: ${pending.request.toolName}`,
          details: resolution,
          durationMs: Math.max(0, Date.now() - (turn.activities.find((item) => item.id === pending.activityId)?.timestamp ?? Date.now())),
          status
        });
        if (activity) this.post({ type: 'activity', activity });
      }
    }
    } catch (error) {
      console.error('[LocalForge] Approval activity update failed:', error instanceof Error ? error.message : String(error));
    } finally {
      pending.resolve(decision === 'allow' || decision === 'allow_session');
      this.post({ type: 'permissionDecision', requestId, decision });
    }
  }

  private setPermissionMode(mode: PermissionMode): void {
    this.engine?.permissionManager.setMode(mode);
    void this.context.globalState?.update('tuxnest.permissionMode', mode);
    this.post({ type: 'permissionMode', mode });
  }

  public modelForTask(task: ModelTask): string | undefined {
    const configuration = vscode.workspace.getConfiguration('tuxnest.routing');
    const preferences: Record<ModelTask, string> = {
      chat: configuration.get<string>('chatModel', ''),
      edit: configuration.get<string>('editModel', ''),
      agent: configuration.get<string>('agentModel', ''),
      completion: configuration.get<string>('completionModel', '')
    };
    const model = routeModel(this.models, task, preferences, this.selectedModel);
    return model?.id || model?.name || preferences[task] || this.selectedModel;
  }

  public setRemoteSession(session?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string }): void {
    this.remoteSession = session;
    void this.postRemoteStatus();
  }

  public async postRemoteStatus(): Promise<void> {
    const session = this.remoteSession;
    if (!session || !session.tunnel.isConnected) {
      this.post({ type: 'remoteStatus', connected: false });
      return;
    }
    let gpuInfo = '';
    try {
      gpuInfo = await session.tunnel.getGpuStatus();
    } catch {
      gpuInfo = 'Connected via SSH tunnel';
    }
    if (this.remoteSession !== session || !session.tunnel.isConnected) return;
    this.post({
      type: 'remoteStatus',
      connected: true,
      profileName: session.profileName,
      gpuInfo
    });
  }

  public async setSelectedModel(model: string): Promise<void> {
    await this.sessionManager.initialize();
    await this.sessionManager.updateSession(this.sessionManager.getActiveSession().id, { model });
    this.selectedModel = model;
    this.post({ type: 'selectedModel', model });
    this.postSessions(false);
  }

  public async startNewSession(): Promise<void> {
    if (this.busy || this.engine?.isBusy()) throw new Error('Wait for the task or cancel it before starting another chat.');
    const session = await this.sessionManager.createNewSession();
    this.engine?.permissionManager.clearSession();
    this.activeMode = session.mode;
    this.activeStrategy = session.strategy;
    this.selectedModel = session.model ?? 'auto';
    this.post({ type: 'selectedModel', model: this.selectedModel });
    this.postSessions();
  }

  private postSessions(includeHistory = true): void {
    const session = this.sessionManager.getActiveSession();
    this.post({ type: 'sessions', activeSessionId: session.id, sessions: this.sessionManager.getSessions().map(({ messages, ...metadata }) => ({ ...metadata, messageCount: messages.length, preview: messages.at(-1)?.content.slice(0, 160) ?? '' })) });
    this.post({ type: 'mode', mode: session.mode });
    this.post({ type: 'strategy', strategy: session.strategy });
    this.post({ type: 'effort', effort: session.effort ?? 'medium' });
    if (includeHistory) {
      this.post({ type: 'history', messages: session.messages });
      this.postActivityHistory();
    }
  }

  private postActivityHistory(): void {
    const conversationId = this.engine?.sessionManager.getActiveSession().id;
    this.post({
      type: 'activityHistory',
      activities: conversationId ? this.engine?.getActivityHistory(conversationId) ?? [] : []
    });
    this.postRecoveryHistory();
  }

  public postRecoveryHistory(): void {
    this.post({ type: 'editRecovery', records: this.engine?.editEngine.getRecoveryHistory() ?? [] });
  }

  public async rollbackRecordedChanges(recoveryId: string, files?: string[]): Promise<void> {
    if (!this.engine) return;
    const record = this.engine.editEngine.getRecoveryHistory().find((entry) => entry.id === recoveryId);
    if (!record) {
      this.post({ type: 'error', message: 'This edit recovery record is unavailable.' });
      return;
    }
    const selectedFiles = files ?? record.remainingFiles;
    const choice = await vscode.window.showWarningMessage(
      `Restore ${selectedFiles.length} recorded file(s)? Newly created files will be removed. Files changed since this edit will not be overwritten.`,
      { modal: true }, 'Restore changes'
    );
    if (choice !== 'Restore changes') return;
    if (this.engine.isBusy()) {
      this.post({ type: 'error', message: 'Wait for the running task before restoring recorded changes.' });
      return;
    }
    const interaction = Symbol('rollback');
    this.activeInteraction = interaction;
    this.busy = true;
    this.post({ type: 'status', state: 'running', message: 'Restoring recorded changes...' });
    try {
      const result = await this.engine.rollbackRecordedChanges(recoveryId, files, (activity) => this.post({ type: 'activity', activity }));
      this.post({ type: 'recoveryResult', success: result.success, summary: result.success
        ? `Restored ${result.restoredFiles.length} file(s); ${result.unchangedFiles.length} were already unchanged.`
        : `Rollback refused or incomplete: ${result.conflicts.map((conflict) => `${conflict.path}: ${conflict.error}`).join('\n')}` });
    } catch (error) {
      this.post({ type: 'recoveryResult', success: false, summary: error instanceof Error ? error.message : String(error) });
    } finally {
      this.postRecoveryHistory();
      if (this.activeInteraction === interaction) {
        this.busy = false;
        this.activeInteraction = undefined;
        this.post({ type: 'status', state: 'ready', message: 'Ready' });
      }
    }
  }

  public postActiveEditor(relPath: string): void {
    this.post({ type: 'activeEditor', path: relPath });
  }


  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    view.webview.html = getHtml(view.webview, this.context.extensionUri);

    view.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      try {
      const message = (rawMessage && typeof rawMessage === 'object') ? { ...(rawMessage as Record<string, unknown>) } : rawMessage;
      if (message && typeof message === 'object' && (message as Record<string, unknown>).type === 'chat') {
        const chatMsg = message as Record<string, unknown>;
        if (typeof chatMsg.model !== 'string' || !chatMsg.model) {
          chatMsg.model = this.selectedModel || 'auto';
        }
        if (typeof chatMsg.includeContext !== 'boolean') {
          chatMsg.includeContext = true;
        }
        if (typeof chatMsg.includeWorkspace !== 'boolean') {
          chatMsg.includeWorkspace = true;
        }
        if (typeof chatMsg.agentMode !== 'boolean') {
          chatMsg.agentMode = this.activeMode === 'agent';
        }
      }

      if (!isWebviewMessage(message)) {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'updateSettings') this.post({ type: 'error', message: 'Invalid settings values. Endpoint URLs require HTTP(S) without credentials, query parameters or fragments. No settings were saved.' });
        console.warn('[TuxNest] Received unrecognized webview message; payload omitted.');
        return;
      }

      if (message.type === 'ready' || message.type === 'refresh') {
        await this.refresh();
      }

      if (message.type === 'setMode') {
        await this.sessionManager.updateSession(this.sessionManager.getActiveSession().id, { mode: message.mode });
        this.activeMode = message.mode;
        this.post({ type: 'mode', mode: this.activeMode });
      }

      if (message.type === 'setStrategy') {
        await this.sessionManager.updateSession(this.sessionManager.getActiveSession().id, { strategy: message.strategy });
        this.activeStrategy = message.strategy;
        this.post({ type: 'strategy', strategy: this.activeStrategy });
      }

      if (message.type === 'setEffort') {
        try {
          if (this.busy || this.engine?.isBusy()) throw new Error('Wait for the task or cancel it before changing effort.');
          await this.sessionManager.updateSession(this.sessionManager.getActiveSession().id, { effort: message.effort });
        } catch (error) {
          this.post({ type: 'controlError', message: error instanceof Error ? error.message : String(error) });
        } finally {
          this.post({ type: 'effort', effort: this.sessionManager.getActiveSession().effort ?? 'medium' });
        }
      }

      if (message.type === 'selectModel') {
        await this.setSelectedModel(message.model);
      }
      if (message.type === 'reindexWorkspace') {
        if (!this.engine?.indexer) throw new Error('Open a trusted project workspace before rebuilding its index.');
        if (this.engine.accessPolicy.getState().scope === 'file') throw new Error('Workspace reindex is unavailable with File access.');
        await this.engine.indexer.indexWorkspace();
        this.postIndexStatus();
      }

      if (message.type === 'setAccessScope' && this.engine) {
        try {
          if (this.busy || this.engine.isBusy()) throw new Error('Wait for the task or cancel it before changing access.');
          let filePath: string | undefined;
          if (message.scope === 'machine') {
            const choice = await vscode.window.showWarningMessage('Full Machine enables explicitly approved outside-workspace reads and host commands under your existing OS account. It does not grant administrator rights or an OS sandbox. Secrets may be sent to your selected model if you approve reading them. Workspace diffs remain workspace-only.', { modal: true }, 'Enable Full Machine');
            if (choice !== 'Enable Full Machine') return;
          }
          if (message.scope === 'file') {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!root) throw new Error('Open a project workspace before selecting a file.');
            const chosen = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: vscode.window.activeTextEditor?.document.uri ?? root, openLabel: 'Allow this file only' });
            if (!chosen?.[0]) return;
            if (vscode.workspace.getWorkspaceFolder(chosen[0])?.uri.toString() !== root.toString()) throw new Error('Choose a file within the current workspace. Use Full Machine for explicitly approved external inspection.');
            filePath = relative(root.fsPath, chosen[0].fsPath).replace(/\\/g, '/');
            validateRelativeWorkspacePath(filePath);
          }
          this.engine.setAccessScope(message.scope, filePath);
        } catch (error) {
          this.post({ type: 'error', message: error instanceof Error ? error.message : 'Could not change access.' });
        } finally {
          this.post({ type: 'accessScope', ...this.engine.accessPolicy.getState() });
          this.postIndexStatus();
        }
      }

      if (message.type === 'openModels') await vscode.commands.executeCommand('tuxnest.modelsView.focus');
      if (message.type === 'getContextFiles') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        const files: string[] = [];
        if (root && vscode.workspace.isTrusted !== false) {
          const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*'), '**/{node_modules,.git,dist,build,.next,.venv}/**', 1000);
          for (const uri of uris) {
            const filePath = relative(root.fsPath, uri.fsPath).replace(/\\/g, '/');
            if (!await canAttachWorkspaceContext(uri)) continue;
            try { this.engine?.accessPolicy.assertFile(filePath); } catch { continue; }
            files.push(filePath);
          }
        }
        this.post({ type: 'contextFiles', files: files.sort() });
      }

      if (message.type === 'getRemoteStatus') {
        await this.postRemoteStatus();
      }

      if (message.type === 'connectRemote') {
        await vscode.commands.executeCommand('tuxnest.connectRemote');
      }

      if (message.type === 'disconnectRemote') {
        await vscode.commands.executeCommand('tuxnest.disconnectRemote');
      }

      if (message.type === 'configureRemote') {
        await vscode.commands.executeCommand('tuxnest.configureRemote');
      }

      if (message.type === 'diagnose') {
        await vscode.commands.executeCommand('tuxnest.diagnose');
      }

      if (message.type === 'continueTask') {
        await vscode.commands.executeCommand('tuxnest.continueTask');
      }

      if (message.type === 'clear') {
        if (this.busy || this.engine?.isBusy()) throw new Error('Wait for the task or cancel it before clearing chat.');
        const id = this.sessionManager.getActiveSession().id;
        if (this.engine) await this.engine.clearConversation(id);
        else await this.sessionManager.clearSession(id);
        this.postSessions();
      }

      if (message.type === 'newSession') {
        await this.startNewSession();
      }

      if (message.type === 'loadSession') {
        if (this.busy || this.engine?.isBusy()) throw new Error('Wait for the task or cancel it before switching chat.');
        const session = await this.sessionManager.setActiveSession(message.sessionId);
        if (!session) throw new Error('This chat is unavailable.');
        this.selectedModel = session.model;
        this.activeMode = session.mode;
        this.activeStrategy = session.strategy;
        this.engine?.permissionManager.clearSession();
        await this.refresh();
      }

      if (message.type === 'deleteSession') {
        if (this.busy || this.engine?.isBusy()) throw new Error('Wait for the task or cancel it before deleting chat.');
        const session = this.sessionManager.getSessions().find((session) => session.id === message.sessionId);
        if (!session) return;
        const choice = await vscode.window.showWarningMessage(`Delete chat "${session.title}"? Its messages will be removed. Workspace files and edit recovery backups are kept.`, { modal: true }, 'Delete chat');
        if (choice !== 'Delete chat') return;
        if (this.engine) await this.engine.deleteConversation(message.sessionId);
        else await this.sessionManager.deleteSession(message.sessionId);
        this.engine?.permissionManager.clearSession();
        this.selectedModel = this.sessionManager.getActiveSession().model;
        await this.refresh();
      }

      if (message.type === 'renameSession') {
        const session = this.sessionManager.getSessions().find((session) => session.id === message.sessionId);
        if (!session) throw new Error('This chat is unavailable.');
        const title = await vscode.window.showInputBox({ title: 'Rename chat', value: session.title, validateInput: (value) => !value.trim() || value.length > 120 ? 'Enter 1–120 characters.' : undefined });
        if (title !== undefined) await this.sessionManager.renameSession(session.id, title);
        this.postSessions(false);
      }

      if (message.type === 'updateSettings') {
        if (message.settings && typeof message.settings === 'object') {
          const config = vscode.workspace.getConfiguration('tuxnest');
          if (Object.keys(message.settings).some((key) => key.startsWith('chatMemory.') || key.startsWith('context.')) && !vscode.workspace.workspaceFolders?.length) throw new Error('Open a workspace before changing workspace memory/index settings.');
          if (message.settings['chatMemory.scope'] === 'all' && config.get<string>('chatMemory.scope', 'current') !== 'all') {
            const choice = await vscode.window.showWarningMessage('Allow retrieval from all chats in this workspace? Retrieved messages can be sent to the selected model endpoint. Current chat only is the private default.', { modal: true }, 'Allow all-chat memory');
            if (choice !== 'Allow all-chat memory') { this.postAgentSettings(); return; }
          }
          for (const [key, val] of Object.entries(message.settings)) {
            await config.update(key, val, key.startsWith('chatMemory.') || key.startsWith('context.') ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
          }
        }
        this.postAgentSettings();
        if (this.engine && ('ollama.baseUrl' in message.settings || 'providers.openAICompatibleUrls' in message.settings)) {
          await this.engine.updateProviderConfiguration({ ollamaEndpoint: vscode.workspace.getConfiguration('tuxnest.ollama').get<string>('baseUrl', 'http://127.0.0.1:11434'), openAiEndpoints: vscode.workspace.getConfiguration('tuxnest.providers').get<string>('openAICompatibleUrls', '') });
          await this.refresh();
        }
      }

      if (message.type === 'cancel') {
        this.cancelActiveChat();
      }

      if (message.type === 'openFile') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root && message.filePath) {
          try {
            const uri = vscode.Uri.joinPath(root, ...validateRelativeWorkspacePath(message.filePath));
            if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.toString()) {
              throw new Error('The requested file is outside the workspace folder.');
            }
            if (root.scheme === 'file') {
              const realRoot = await realpath(root.fsPath);
              const realFile = await realpath(uri.fsPath);
              const relativeFile = relative(realRoot, realFile);
              if (relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
                throw new Error('The requested file resolves outside the workspace folder.');
              }
            }
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
          } catch {}
        }
      }

      if (message.type === 'showDiff') {
        if (this.engine && message.proposalId && message.filePath) {
          await this.engine.editEngine.showDiff(message.proposalId, message.filePath);
        }
      }

      if (message.type === 'applyEdit') {
        if (this.engine && message.proposalId) {
          if (this.engine.isBusy()) {
            this.post({ type: 'error', message: 'Wait for the running task before applying a proposal.' });
            return;
          }
          const interaction = Symbol('apply');
          this.activeInteraction = interaction;
          this.busy = true;
          try {
            const res = await this.engine.applyProposalAndValidate(
              message.proposalId,
              message.files,
              (activity: TurnActivity) => this.post({ type: 'activity', activity }),
              (progress: string) => { if (this.activeInteraction === interaction) this.post({ type: 'status', state: 'running', message: progress }); },
              (artifact: Artifact) => this.post({ type: 'artifact', artifact })
            );
            this.post({
              type: 'editResult',
              proposalId: message.proposalId,
              success: res.success && res.validationPassed !== false,
              applied: res.appliedCount > 0,
              validationPassed: res.validationPassed,
              summary: res.success
                ? res.validationPassed === false
                  ? `Applied changes to ${res.appliedCount} file(s), but project validation did not pass.`
                  : `Applied changes to ${res.appliedCount} file(s).`
                : `Apply failed: ${res.errors?.map((error: any) => error.error).join(', ') || 'Validation failed'}`
            });
          } catch (error) {
            this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          } finally {
            this.postRecoveryHistory();
            if (this.activeInteraction === interaction) {
              this.busy = false;
              this.activeInteraction = undefined;
              this.post({ type: 'status', state: 'ready', message: 'Ready' });
            }
          }
        }
      }

      if (message.type === 'rollbackEdit') {
        await this.rollbackRecordedChanges(message.recoveryId, message.files);
      }

      if (message.type === 'forgetEditRecovery' && this.engine) {
        const choice = await vscode.window.showWarningMessage('Remove this local source backup? Its recorded Undo will no longer be available. This does not change workspace files.', { modal: true }, 'Remove backup');
        if (choice === 'Remove backup') {
          try { await this.engine.editEngine.forgetRecovery(message.recoveryId); }
          catch (error) { this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) }); }
          this.postRecoveryHistory();
        }
      }

      if (message.type === 'rejectEdit') {
        if (this.engine && message.proposalId) {
          try {
            this.engine.editEngine.rejectProposal(message.proposalId);
            this.post({ type: 'editResult', proposalId: message.proposalId, success: false, summary: 'Pending proposed edits discarded.' });
            this.post({ type: 'activity', activity: {
              id: `act-${Date.now()}`,
              category: 'Cancelled',
              title: 'Proposal rejected by user',
              status: 'cancelled',
              timestamp: Date.now()
            }});
          } catch (error) {
            this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
          }
        }
      }

      if (message.type === 'proceedArtifact') {
        if (this.engine) {
          const art = this.engine.artifactManager.getArtifact(message.artifactId);
          if (art) {
            this.engine.artifactManager.updateStatus(message.artifactId, 'approved');
            this.post({ type: 'artifactUpdated', artifact: art });
            // Send continuation to engine to execute the approved plan
            await this.handleChatMessage({
              model: this.selectedModel ?? '',
              prompt: `Proceed with approved plan: ${art.title}`,
              includeContext: true,
              includeWorkspace: true,
              agentMode: true
            });
          }
        }
      }

      if (message.type === 'commentArtifact') {
        if (this.engine) {
          this.engine.artifactManager.addComment(message.artifactId, {
            author: 'User',
            text: message.comment
          });
          const art = this.engine.artifactManager.getArtifact(message.artifactId);
          if (art) {
            this.post({ type: 'artifactUpdated', artifact: art });
          }
        }
      }

      if (message.type === 'permissionResolved') {
        this.resolvePermissionRequest(message.requestId, message.decision);
      }

      if (message.type === 'setPermissionMode') {
        this.setPermissionMode(message.mode);
      }

      if (message.type === 'chat') {
        await this.handleChatMessage(message);
      }
      } catch (error) {
        this.post({ type: 'error', message: error instanceof Error ? error.message : 'Could not update chat.' });
      }
    });
  }

  public async refresh(): Promise<void> {
    try {
      await this.sessionManager.initialize();
      const session = this.sessionManager.getActiveSession();
      this.selectedModel = session.model ?? this.selectedModel;
      this.activeMode = session.mode;
      this.activeStrategy = session.strategy;
      if (this.engine) {
        let models = this.engine.modelRegistry.getModels();
        if (models.length === 0) {
          try {
            await this.engine.modelRegistry.discoverAll();
            models = this.engine.modelRegistry.getModels();
          } catch {}
        }
        this.models = models;
      } else {
        this.models = await this.provider.listModels();
      }

      if (!this.selectedModel && this.models.length > 0) {
        const preferred = this.modelForTask('agent');
        this.selectedModel = preferred || this.models[0].id || this.models[0].name;
      }

      this.post({
        type: 'models',
        models: this.models,
        selectedModel: this.selectedModel
      });

      this.postSessions();
      await this.postRemoteStatus();

      if (vscode.window.activeTextEditor) {
        this.postActiveEditor(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri));
      }

      this.post({
        type: 'status',
        state: 'ready',
        message: `${this.models.length} model(s) available`
      });
      this.post({ type: 'permissionMode', mode: this.engine?.permissionManager.getMode() ?? 'always_ask', workspaceSession: this.engine?.permissionManager.hasWorkspaceSessionApproval() ?? false });
      this.post({ type: 'accessScope', ...(this.engine?.accessPolicy.getState() ?? { scope: 'workspace' }) });
      this.postAgentSettings();
      this.postIndexStatus();
      this.postProviderStatus();
      for (const pending of this.pendingPermissionRequests.values()) {
        if (!pending.request.signal?.aborted) this.postPermissionRequest(pending.request);
      }
    } catch (error) {
      this.post({
        type: 'status',
        state: 'error',
        message: error instanceof Error ? error.message : 'Discovery failed'
      });
    }
  }

  public cancelActiveChat(): void {
    this.activeInteraction = undefined;
    if (this.activeChat) {
      this.activeChat.abort();
      this.activeChat = undefined;
    }
    if (this.engine) {
      this.engine.cancelCurrentTask();
    }
    for (const requestId of this.pendingPermissionRequests.keys()) {
      this.resolvePermissionRequest(requestId, 'cancelled');
    }
    this.busy = false;
    this.post({ type: 'status', state: 'ready', message: 'Ready' });
    this.post({ type: 'activity', activity: {
      id: `act-${Date.now()}`,
      category: 'Cancelled',
      title: 'Task cancelled by user',
      status: 'cancelled',
      timestamp: Date.now()
    }});
  }

  private postAgentSettings(): void {
    const configuration = vscode.workspace.getConfiguration('tuxnest');
    this.post({ type: 'agentSettings', maxRounds: configuration.get<number>('agent.maxRounds', 80), contextWindow: configuration.get<number>('ollama.contextWindow', 8192), maxOutputTokens: configuration.get<number>('ollama.maxOutputTokens', -1),
      chatMemory: { enabled: configuration.get('chatMemory.enabled', true), scope: configuration.get('chatMemory.scope', 'current'), recentCharacters: configuration.get('chatMemory.recentCharacters', 6000), retrievedCharacters: configuration.get('chatMemory.retrievedCharacters', 3000), resultCount: configuration.get('chatMemory.resultCount', 4) },
      workspaceIndex: { maxIndexedFiles: configuration.get('context.maxIndexedFiles', 2000), maxFileBytes: configuration.get('context.maxFileBytes', 262144), maxIndexCharacters: configuration.get('context.maxIndexCharacters', 8000000) },
      endpoints: { ollama: configuration.get('ollama.baseUrl', 'http://127.0.0.1:11434'), compatible: configuration.get('providers.openAICompatibleUrls', defaultCompatibleEndpoints) } });
  }

  private postProviderStatus(): void {
    const health = this.engine?.modelRegistry.getHealthReport?.() ?? [];
    this.post({ type: 'providerStatus', ...this.engine?.getProviderConfigurationStatus?.(), providers: (this.engine?.modelRegistry.getProviders?.() ?? []).map((provider) => ({ ...provider, ...health.find((entry) => entry.id === provider.id) })) });
  }

  public async sendUserPrompt(prompt: string, options: { includeContext?: boolean; mode?: AgentMode; strategy?: ExecutionStrategy } = {}): Promise<void> {
    if (!this.selectedModel && this.models.length > 0) {
      this.selectedModel = this.models[0].id || this.models[0].name;
    }
    if (options.mode) {
      this.activeMode = options.mode;
      this.post({ type: 'mode', mode: this.activeMode });
    }
    if (options.strategy) {
      this.activeStrategy = options.strategy;
      this.post({ type: 'strategy', strategy: this.activeStrategy });
    }
    await this.handleChatMessage({
      model: this.selectedModel ?? '',
      prompt,
      includeContext: options.includeContext ?? true,
      includeWorkspace: true,
      agentMode: this.activeMode === 'agent'
    });
  }

  private async handleChatMessage(message: {
    model?: string;
    prompt: string;
    includeContext?: boolean;
    includeWorkspace?: boolean;
    agentMode?: boolean;
    files?: string[];
  }): Promise<void> {
    if (this.busy) {
      console.warn('[TuxNest] Cancelling prior in-flight task for incoming prompt.');
      this.cancelActiveChat();
    }
    const interaction = Symbol('chat');
    this.activeInteraction = interaction;
    this.busy = true;

    const modelName = (message.model && message.model !== 'auto')
      ? message.model
      : (this.selectedModel && this.selectedModel !== 'auto' ? this.selectedModel : '');
    const mode = this.activeMode;
    const session = this.sessionManager.getActiveSession();
    const history = session.messages;
    let finalStatusMessage = 'Ready';

    this.post({ type: 'status', state: 'thinking', message: 'Analyzing task...' });
    this.post({ type: 'userMessage', content: message.prompt });

    try {
      await this.sessionManager.initialize();
      if (this.activeInteraction !== interaction) return;
      if (message.files?.length) {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root || vscode.workspace.isTrusted === false) throw new Error('Open a trusted workspace to attach files.');
        for (const filePath of message.files) {
          validateRelativeWorkspacePath(filePath);
          this.engine?.accessPolicy.assertFile(filePath);
          if (!await canAttachWorkspaceContext(vscode.Uri.joinPath(root, filePath))) throw new Error(`Cannot attach ${filePath}: outside workspace or sensitive file.`);
        }
        message = { ...message, prompt: message.prompt + '\n' + message.files.map(filePath => '@file:' + JSON.stringify(filePath)).join(' ') };
      }
      if (this.engine) {
        const summary = await this.engine.executeTask(
          message.prompt,
          mode,
          modelName,
          {
            strategy: this.activeStrategy,
            onProgress: (progress) => {
              if (this.activeInteraction === interaction) this.post({ type: 'status', state: 'running', message: progress });
            },
            onToken: (token) => {
              if (this.activeInteraction === interaction) this.post({ type: 'chunk', content: token });
            },
            onActivity: (activity: TurnActivity) => {
              if (this.activeInteraction === interaction) this.post({ type: 'activity', activity });
            },
            onArtifact: (artifact: Artifact) => {
              if (this.activeInteraction === interaction) this.post({ type: 'artifact', artifact });
            }
          }
        );
        if (this.activeInteraction !== interaction) return;

        // Check for pending proposals in the edit engine
        const pending = this.engine.editEngine.getPendingProposals();
        if (pending.length > 0) {
          const latest = pending[0];
          this.post({ type: 'proposal', proposal: latest });
        }
        if (pending.length > 0 || mode === 'plan') {
          finalStatusMessage = 'Waiting for your review';
        } else if (summary.status === 'failed') {
          finalStatusMessage = 'Needs attention · see incomplete actions';
        } else if (summary.status === 'cancelled') {
          finalStatusMessage = 'Cancelled';
        }

        if (!this.engine.sessionManager) await this.sessionManager.appendMessages(session.id, [{ role: 'user', content: message.prompt }, { role: 'assistant', content: summary.response, model: modelName }]);
        this.postSessions(this.engine.referenceResolver?.parseSlashCommand(message.prompt).command === 'clear');

        this.post({ type: 'done', fullResponse: summary.response });
      } else {
        // Fallback direct provider streaming
        this.activeChat = new AbortController();
        let full = '';
        const messages: ChatMessage[] = classifyTaskIntent(message.prompt) === 'conversation' ? conversationalMessages(message.prompt) : [
          ...history.slice(-8),
          { role: 'user', content: message.prompt }
        ];

        await this.provider.streamChat(
          modelName,
          messages,
          (token) => {
            if (this.activeInteraction !== interaction) return;
            full += token;
            this.post({ type: 'chunk', content: token });
          },
          this.activeChat.signal
        );
        if (this.activeInteraction !== interaction) return;

        await this.sessionManager.appendMessages(session.id, [{ role: 'user', content: message.prompt }, { role: 'assistant', content: full, model: modelName }], { model: modelName, mode: this.activeMode, strategy: this.activeStrategy }, { epoch: session.historyEpoch });
        this.postSessions(false);

        this.post({ type: 'done', fullResponse: full });
      }
    } catch (error: any) {
      const errMsg = error?.name === 'AbortError' ? 'Task cancelled.' : error?.message || 'Request failed';
      if (this.activeInteraction === interaction) this.post({ type: 'error', message: errMsg });
    } finally {
      this.postRecoveryHistory();
      if (this.activeInteraction === interaction) {
        this.busy = false;
        this.activeChat = undefined;
        this.activeInteraction = undefined;
        this.post({ type: 'status', state: 'ready', message: finalStatusMessage });
      }
    }
  }

  private post(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }
}

function getHtml(webview: vscode.Webview, extensionUri?: vscode.Uri): string {
  const nonce = randomBytes(16).toString('hex');
  const cspSource = webview.cspSource;


  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>${chatStyles}</style>
</head>
<body>
  <header class="header">
    <div class="header-top">
      <div class="header-title"><span>Chat</span><span id="sessionTitle"></span></div>
      <div class="header-actions">
        <button class="icon-btn" id="newChatBtn" title="New chat" aria-label="New chat">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <details id="chatHistory">
          <summary title="Chat history" aria-label="Chat history"><svg class="icon" viewBox="0 0 24 24"><path d="M3 11a9 9 0 1 1 2.6 6.4M3 4v7h7M12 7v5l3 2"/></svg></summary>
          <div class="history-panel">
            <input id="chatFilter" aria-label="Filter chats" placeholder="Search chats" />
            <button id="clearChatBtn" title="Clear current chat">Clear current chat</button>
            <div id="chatList"></div>
          </div>
        </details>
        <button class="icon-btn" id="settingsBtn" title="Settings" aria-label="Settings">
          <svg class="icon" viewBox="0 0 24 24"><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>
        </button>
      </div>
    </div>
  </header>
  <main class="conversation-area">
    <div class="main-scroll" id="mainScroll" role="region" aria-label="Conversation and actual tool activity" tabindex="0">
      <div class="msg-assistant welcome">
        <span class="welcome-label">TuxNest Chat</span>
        <strong>What would you like to build?</strong>
        <p>Ask about your code, plan a change, or let TuxNest SI Agent work. You review the edits.</p>
      </div>
      <div class="timeline" id="timelineContainer" style="display:none;"></div>
    </div>
    <button class="jump-latest" id="jumpToLatest" type="button" hidden aria-label="Jump to latest activity">↓ Latest</button>
  </main>
  <section class="composer" aria-label="Message composer">
    <div class="composer-input-box">
      <div class="context-row">
        <details id="filePicker">
          <summary>Add context <span id="fileCount"></span></summary>
          <div class="context-panel">
            <div class="ref-chips">
              <button class="chip" type="button" data-ref="@selection">Selection</button>
              <button class="chip" type="button" data-ref="@terminal">Terminal</button>
              <button class="chip" type="button" data-ref="@diagnostics">Diagnostics</button>
              <button class="chip" type="button" data-ref="@git">Git</button>
            </div>
            <input id="fileFilter" type="search" placeholder="Search workspace files" aria-label="Filter workspace files" />
            <div id="fileList">Open to load available files.</div>
          </div>
        </details>
        <span id="activeFileName"></span>
      </div>
      <div id="selectedFiles" aria-label="Attached files"></div>
      <div class="slash-popup" id="slashPopup">
        <div class="slash-item" data-cmd="/plan"><span>/plan</span><span style="color:var(--subtle);">Architecture & plan</span></div>
        <div class="slash-item" data-cmd="/diff"><span>/diff</span><span style="color:var(--subtle);">Inspect pending edits</span></div>
        <div class="slash-item" data-cmd="/search"><span>/search</span><span style="color:var(--subtle);">Search workspace</span></div>
        <div class="slash-item" data-cmd="/terminal"><span>/terminal</span><span style="color:var(--subtle);">Execute shell command</span></div>
        <div class="slash-item" data-cmd="/model"><span>/model</span><span style="color:var(--subtle);">View active model</span></div>
        <div class="slash-item" data-cmd="/context"><span>/context</span><span style="color:var(--subtle);">Context budget info</span></div>
        <div class="slash-item" data-cmd="/diagnose"><span>/diagnose</span><span style="color:var(--subtle);">Diagnose installation</span></div>
        <div class="slash-item" data-cmd="/remote"><span>/remote</span><span style="color:var(--subtle);">SSH remote GPU</span></div>
        <div class="slash-item" data-cmd="/clear"><span>/clear</span><span style="color:var(--subtle);">Clear conversation</span></div>
      </div>
      <textarea id="promptInput" aria-label="Message to TuxNest Chat" placeholder="Ask anything, or describe what to build with TuxNest…" rows="3"></textarea>
      <div class="composer-bottom">
        <select id="modeSelect" aria-label="Conversation mode">
          <option value="agent">Agent</option><option value="ask">Ask</option><option value="plan">Plan</option>
        </select>
        <div class="model-chip">
          <select id="modelSelect" aria-label="Select model"><option value="auto">Auto</option></select>
          <span id="activeModelLabel">Automatic routing</span>
          <span class="model-badge" id="activeModelBadge" title="Model execution location">Auto</span>
        </div>
        <select id="effortSelect" aria-label="Agent effort" title="Low: shorter budgets. Medium: balanced. High: larger configured budgets. Ultra: configured maximum context and no round cap; hardware limits still apply.">
          <option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="ultra">Ultra</option>
        </select>
        <button type="button" class="send-btn" id="sendBtn">Send</button>
      </div>
    </div>
    <div class="toolbar-bar">
      <div class="toolbar-items">
        <button class="toolbar-btn" id="openChangesBtn" title="Review changes">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/></svg>
          <span>Changes</span><span class="toolbar-count" id="changesBadge">0</span>
        </button>
        <button class="toolbar-btn" id="openTerminalBtn" title="Actual terminal activity">
          <svg class="icon" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          <span>Terminal</span><span class="toolbar-count" id="terminalBadge">0</span>
        </button>
      </div>
      <div id="footerStatusText" role="status" aria-live="polite">Ready</div>
    </div>
  </section>

  <!-- Review Changes Drawer -->
  <div class="drawer" id="changesDrawer" role="dialog" aria-modal="true" aria-label="Review Changes" tabindex="-1">
    <div class="drawer-header">
      <div class="drawer-title">Review Changes</div>
      <button class="icon-btn" id="closeChangesBtn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div style="font-size:12px; color:var(--subtle);" id="proposalSummary">No active proposals</div>
    <div class="diff-list" id="diffFileList"></div>
    <details id="recoverySection" style="margin-top:12px; font-size:12px; max-height:45vh; overflow-y:auto;">
      <summary>Recorded changes · Undo</summary>
      <p style="color:var(--subtle);">Local source backups survive reload. Later manual changes are protected.</p>
      <div id="recoveryList">No recorded changes.</div>
    </details>
    <div style="display:flex; gap:8px; margin-top:auto;">
      <button class="action-btn" id="acceptAllBtn" style="flex:1;">Accept All</button>
      <button class="action-btn secondary" id="rejectAllBtn" style="flex:1;">Reject All</button>
    </div>
  </div>

  <!-- Terminal Drawer -->
  <div class="drawer" id="terminalDrawer" role="dialog" aria-modal="true" aria-label="Terminal" tabindex="-1">
    <div class="drawer-header">
      <div class="drawer-title">Terminal Activity</div>
      <button class="icon-btn" id="closeTerminalBtn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="terminalCommandLabel" style="font-size:11.5px; font-weight:600;"></div>
    <div class="terminal-box" id="terminalOutput">No terminal activity recorded.</div>
  </div>

  <!-- Settings Drawer -->
  <div class="drawer" id="settingsDrawer" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
    <div class="drawer-header">
      <div class="drawer-title">TuxNest Settings</div>
      <button class="icon-btn" id="closeSettingsBtn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      <label for="accessScopeSelect">Agent access</label>
      <select id="accessScopeSelect" aria-label="Agent access scope">
        <option value="workspace">Project workspace</option><option value="file">File</option><option value="machine">Full Machine</option>
      </select>
      <label>Execution strategy</label>
      <div class="strategy-toggle" role="group" aria-label="Execution strategy">
        <button class="strat-btn" id="stratFast" title="Direct execution for small tasks">Fast</button>
        <button class="strat-btn active" id="stratPlanning" title="Plan and verify major changes">Planning</button>
      </div>
      <span id="remoteGpuStatus"></span>
      <div class="settings-actions">
        <button class="action-btn secondary" id="refreshBtn">Refresh models</button>
        <button class="action-btn secondary" id="diagnoseBtn">Diagnose installation</button>
      </div>
      <button class="action-btn" id="openModelsBtn">Download & manage models</button>
      <p style="color:var(--subtle);margin:0;">Choose this machine or a connected SSH host in Models. Downloads use that host's Ollama service; GPU inference depends on its available VRAM and runtime.</p>
      <span style="font-size:11px; text-transform:uppercase; color:var(--subtle); font-weight:600;">Endpoints</span>
      <label for="ollamaEndpointInput">Ollama base URL (user settings)</label>
      <input id="ollamaEndpointInput" type="url" required maxlength="2048" style="width:100%;box-sizing:border-box;" />
      <label for="compatibleEndpointsInput">Compatible API base URLs (user settings)</label>
      <textarea id="compatibleEndpointsInput" maxlength="16384" rows="3" style="width:100%;box-sizing:border-box;" aria-describedby="providerPrivacy"></textarea>
      <div id="providerPrivacy" style="font-size:11px;color:var(--subtle);">One base URL per line or comma. Remote/API endpoints receive the prompts and context you send to their models. Changes wait for active work to finish.</div>
      <button class="action-btn secondary" id="saveProviderSettings">Save endpoints</button>
      <div id="providerStatus" role="status" style="font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;">Checking endpoints…</div>
      <div style="background:var(--card-bg); padding:8px; border-radius:4px; font-size:11.5px; display:flex; justify-content:space-between; align-items:center;">
        <span>Remote GPU Host (SSH)</span>
        <button class="action-btn secondary" id="sshConnectBtn" style="padding:2px 8px;">Connect SSH</button>
      </div>
      <div style="background:var(--card-bg); padding:8px; border-radius:4px; font-size:11.5px; display:flex; justify-content:space-between; align-items:center;">
        <span>Configure SSH Profiles</span>
        <button class="action-btn secondary" id="sshConfigBtn" style="padding:2px 8px;">Add Profile</button>
      </div>
      <div style="background:var(--card-bg); padding:8px; border-radius:4px; font-size:11.5px; display:flex; justify-content:space-between; align-items:center;">
        <span>Continue Previous Task</span>
        <button class="action-btn secondary" id="continueTaskBtn" style="padding:2px 8px;">Continue</button>
      </div>
      <label for="permissionModeSelect" style="font-size:11px; text-transform:uppercase; color:var(--subtle); font-weight:600; margin-top:8px;">Command and edit approvals</label>
      <select id="permissionModeSelect" style="width:100%; padding:7px; color:var(--input-fg); background:var(--input-bg); border:1px solid var(--border); border-radius:4px;">
        <option value="allow_safe_auto">Auto-run reviewed safe commands</option>
        <option value="ask_once_per_session">Ask once per session</option>
        <option value="always_ask" selected>Ask before every edit or command (recommended)</option>
        <option value="always_proceed">Always proceed (higher risk)</option>
      </select>
      <div style="font-size:11px; color:var(--subtle);">Read-only inspection remains automatic. Critical system operations stay blocked.</div>
      <label for="agentRoundsInput">Task rounds (0 = until done or cancelled)</label>
      <input id="agentRoundsInput" type="number" min="0" max="10000" value="80" />
      <label for="ollamaContextInput">Local model context window</label>
      <input id="ollamaContextInput" type="number" min="2048" max="1048576" value="8192" />
      <label for="ollamaOutputInput">Local output tokens (-1 = no extension cap)</label>
      <input id="ollamaOutputInput" type="number" min="-1" max="1048576" value="-1" />
      <button class="action-btn secondary" id="saveAgentSettings">Save limits</button>
      <label><input id="chatMemoryEnabled" type="checkbox" /> Retrieve older chat messages locally</label>
      <label for="chatMemoryScope">Chat memory scope (workspace setting)</label>
      <select id="chatMemoryScope"><option value="current">Current chat only (default)</option><option value="all">All chats in this workspace</option></select>
      <label for="recentChatBudget">Recent chat characters</label>
      <input id="recentChatBudget" type="number" min="0" max="32000" />
      <label for="retrievedChatBudget">Retrieved older-chat characters</label>
      <input id="retrievedChatBudget" type="number" min="0" max="16000" />
      <label for="chatMemoryCount">Retrieved message limit</label>
      <input id="chatMemoryCount" type="number" min="1" max="20" />
      <button class="action-btn secondary" id="saveChatMemorySettings">Save chat memory</button>
      <label>Workspace index (workspace settings)</label>
      <div id="workspaceIndexStatus" role="status" style="font-size:11px; color:var(--subtle);">Index status unavailable</div>
      <button class="action-btn secondary" id="rebuildWorkspaceIndex">Rebuild workspace index</button>
      <label for="maxIndexedFiles">Maximum indexed files</label><input id="maxIndexedFiles" type="number" min="1" max="20000" />
      <label for="maxFileBytes">Maximum bytes per file</label><input id="maxFileBytes" type="number" min="1024" max="8388608" />
      <label for="maxIndexCharacters">Maximum retained source characters</label><input id="maxIndexCharacters" type="number" min="100000" max="64000000" />
      <button class="action-btn secondary" id="saveWorkspaceIndexSettings">Save index limits</button>
      <div style="font-size:11px; color:var(--subtle);">Changes apply to the next request. File access and greetings exclude chat memory. Use /search chat &lt;query&gt; and /context to inspect evidence. Clearing/deleting chat removes its retrievable messages.</div>
      <div style="font-size:11px; color:var(--subtle);">Local inference has no publisher token quota. Context, RAM/VRAM and model capability remain finite. Commands are not OS-sandboxed. Internet page reads and recognized network commands require approval.</div>
    </div>
  </div>

  <script nonce="${nonce}">
    window.addEventListener('error', function(e) {
      console.error('[LocalForge Webview Error]', e.error || e.message);
    });

    const vscode = (function() {
      try {
        if (window.__cachedVsCodeApi) return window.__cachedVsCodeApi;
        const api = acquireVsCodeApi();
        window.__cachedVsCodeApi = api;
        return api;
      } catch (err) {
        console.warn('[TuxNest] acquireVsCodeApi reuse or error:', err);
        return window.__cachedVsCodeApi || { postMessage: function() {} };
      }
    })();

    const mainScroll = document.getElementById('mainScroll');
    const jumpToLatest = document.getElementById('jumpToLatest');
    const timelineContainer = document.getElementById('timelineContainer');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const slashPopup = document.getElementById('slashPopup');
    const modelSelect = document.getElementById('modelSelect');
    const effortSelect = document.getElementById('effortSelect');
    effortSelect.addEventListener('change', () => vscode.postMessage({ type: 'setEffort', effort: effortSelect.value }));
    const activeModelLabel = document.getElementById('activeModelLabel');
    const activeModelBadge = document.getElementById('activeModelBadge');
    const remoteGpuStatus = document.getElementById('remoteGpuStatus');
    const activeFileName = document.getElementById('activeFileName');
    const footerStatusText = document.getElementById('footerStatusText');
    const changesBadge = document.getElementById('changesBadge');
    const terminalBadge = document.getElementById('terminalBadge');
    const changesDrawer = document.getElementById('changesDrawer');
    const terminalDrawer = document.getElementById('terminalDrawer');
    const settingsDrawer = document.getElementById('settingsDrawer');
    const ollamaEndpointInput = document.getElementById('ollamaEndpointInput');
    const compatibleEndpointsInput = document.getElementById('compatibleEndpointsInput');
    document.getElementById('saveProviderSettings').addEventListener('click', () => {
      if (!ollamaEndpointInput.reportValidity()) return;
      vscode.postMessage({ type: 'updateSettings', settings: { 'ollama.baseUrl': ollamaEndpointInput.value.trim(), 'providers.openAICompatibleUrls': compatibleEndpointsInput.value } });
    });
    const permissionModeSelect = document.getElementById('permissionModeSelect');
    const accessScopeSelect = document.getElementById('accessScopeSelect');
    const agentRoundsInput = document.getElementById('agentRoundsInput');
    const ollamaContextInput = document.getElementById('ollamaContextInput');
    const ollamaOutputInput = document.getElementById('ollamaOutputInput');
    const chatMemoryEnabled = document.getElementById('chatMemoryEnabled');
    const chatMemoryScope = document.getElementById('chatMemoryScope');
    const recentChatBudget = document.getElementById('recentChatBudget');
    const retrievedChatBudget = document.getElementById('retrievedChatBudget');
    const chatMemoryCount = document.getElementById('chatMemoryCount');
    const maxIndexedFiles = document.getElementById('maxIndexedFiles');
    const maxFileBytes = document.getElementById('maxFileBytes');
    const maxIndexCharacters = document.getElementById('maxIndexCharacters');
    document.getElementById('rebuildWorkspaceIndex').addEventListener('click', () => vscode.postMessage({ type: 'reindexWorkspace' }));
    document.getElementById('saveWorkspaceIndexSettings').addEventListener('click', () => {
      if (![maxIndexedFiles, maxFileBytes, maxIndexCharacters].every(input => input.value !== '' && input.reportValidity())) return;
      vscode.postMessage({ type: 'updateSettings', settings: { 'context.maxIndexedFiles': Number(maxIndexedFiles.value), 'context.maxFileBytes': Number(maxFileBytes.value), 'context.maxIndexCharacters': Number(maxIndexCharacters.value) } });
    });
    document.getElementById('saveChatMemorySettings').addEventListener('click', () => {
      if (![recentChatBudget, retrievedChatBudget, chatMemoryCount].every(input => input.value !== '' && input.reportValidity())) return;
      vscode.postMessage({ type: 'updateSettings', settings: { 'chatMemory.enabled': chatMemoryEnabled.checked, 'chatMemory.scope': chatMemoryScope.value, 'chatMemory.recentCharacters': Number(recentChatBudget.value), 'chatMemory.retrievedCharacters': Number(retrievedChatBudget.value), 'chatMemory.resultCount': Number(chatMemoryCount.value) } });
    });
    accessScopeSelect.addEventListener('change', () => vscode.postMessage({ type: 'setAccessScope', scope: accessScopeSelect.value }));
    document.getElementById('saveAgentSettings').addEventListener('click', () => {
      if (![agentRoundsInput, ollamaContextInput, ollamaOutputInput].every(input => input.value !== '' && input.reportValidity())) return;
      vscode.postMessage({ type: 'updateSettings', settings: { 'agent.maxRounds': Number(agentRoundsInput.value), 'ollama.contextWindow': Number(ollamaContextInput.value), 'ollama.maxOutputTokens': Number(ollamaOutputInput.value) } });
    });
    const diffFileList = document.getElementById('diffFileList');
    const proposalSummary = document.getElementById('proposalSummary');
    const terminalOutput = document.getElementById('terminalOutput');
    const terminalCommandLabel = document.getElementById('terminalCommandLabel');

    let drawerOpener = null;
    function openDrawer(drawer) {
      drawerOpener = document.activeElement;
      document.querySelectorAll('#filePicker, #chatHistory').forEach(picker => { picker.open = false; });
      [settingsDrawer, changesDrawer, terminalDrawer].forEach(item => item.classList.remove('open'));
      drawer.classList.add('open');
      Array.from(document.body.children).forEach(item => { item.inert = item !== drawer; });
      drawer.focus();
    }
    function closeDrawer(drawer) {
      drawer.classList.remove('open');
      Array.from(document.body.children).forEach(item => { item.inert = false; });
      drawerOpener?.focus();
    }
    document.addEventListener('keydown', event => {
      const drawer = [settingsDrawer, changesDrawer, terminalDrawer].find(item => item.classList.contains('open'));
      if (!drawer) return;
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(drawer); }
      if (event.key === 'Tab') {
        const controls = Array.from(drawer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')).filter(item => item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); drawer.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === drawer)) { event.preventDefault(); first.focus(); }
      }
    });
    document.getElementById('openModelsBtn').addEventListener('click', () => vscode.postMessage({ type: 'openModels' }));

    let currentMode = 'agent';
    let currentStrategy = 'planning';
    let isBusy = false;
    let cancellationRequested = false;
    let displayedBusy;
    let availableModels = [];
    let selectedModelId = 'auto';
    let activeProposal = null;

    const modeSelect = document.getElementById('modeSelect');
    modeSelect.addEventListener('change', () => {
      currentMode = modeSelect.value;
      vscode.postMessage({ type: 'setMode', mode: currentMode });
    });

    // Strategy Buttons
    document.getElementById('stratFast').addEventListener('click', () => {
      document.getElementById('stratFast').classList.add('active');
      document.getElementById('stratPlanning').classList.remove('active');
      currentStrategy = 'fast';
      vscode.postMessage({ type: 'setStrategy', strategy: 'fast' });
    });
    document.getElementById('stratPlanning').addEventListener('click', () => {
      document.getElementById('stratPlanning').classList.add('active');
      document.getElementById('stratFast').classList.remove('active');
      currentStrategy = 'planning';
      vscode.postMessage({ type: 'setStrategy', strategy: 'planning' });
    });

    // Header Action Buttons
    document.getElementById('newChatBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'newSession' });
    });
    document.getElementById('refreshBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('diagnoseBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'diagnose' });
    });
    document.getElementById('settingsBtn').addEventListener('click', () => {
      openDrawer(settingsDrawer);
    });
    let chats = [];
    let activeSessionId = '';
    function renderChats() {
      const list = document.getElementById('chatList');
      list.replaceChildren();
      const query = document.getElementById('chatFilter').value.trim().toLowerCase();
      chats.filter(chat => (chat.title + ' ' + chat.preview).toLowerCase().includes(query)).forEach(chat => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;align-items:center;padding:3px 0;';
        const open = document.createElement('button');
        open.className = 'icon-btn';
        open.style.cssText = 'flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        open.textContent = (chat.id === activeSessionId ? '• ' : '') + chat.title;
        open.title = chat.preview || chat.title;
        open.setAttribute('aria-current', chat.id === activeSessionId ? 'true' : 'false');
        open.addEventListener('click', () => vscode.postMessage({ type: 'loadSession', sessionId: chat.id }));
        row.appendChild(open);
        for (const action of [{ label: 'Rename', type: 'renameSession' }, { label: 'Delete', type: 'deleteSession' }]) {
          const button = document.createElement('button');
          button.className = 'icon-btn';
          button.textContent = action.label;
          button.addEventListener('click', () => vscode.postMessage({ type: action.type, sessionId: chat.id }));
          row.appendChild(button);
        }
        list.appendChild(row);
      });
    }
    document.getElementById('chatFilter').addEventListener('input', renderChats);
    document.getElementById('clearChatBtn').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    permissionModeSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setPermissionMode', mode: permissionModeSelect.value });
    });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      closeDrawer(settingsDrawer);
    });
    document.getElementById('sshConnectBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'connectRemote' });
    });
    document.getElementById('sshConfigBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'configureRemote' });
    });
    document.getElementById('continueTaskBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'continueTask' });
    });

    // Toolbar Drawers
    document.getElementById('openChangesBtn').addEventListener('click', () => {
      openDrawer(changesDrawer);
    });
    document.getElementById('closeChangesBtn').addEventListener('click', () => {
      closeDrawer(changesDrawer);
    });
    document.getElementById('openTerminalBtn').addEventListener('click', () => {
      openDrawer(terminalDrawer);
    });
    document.getElementById('closeTerminalBtn').addEventListener('click', () => {
      closeDrawer(terminalDrawer);
    });

    // Proposal Actions
    document.getElementById('acceptAllBtn').addEventListener('click', () => {
      if (activeProposal) {
        vscode.postMessage({ type: 'applyEdit', proposalId: activeProposal.id });
        closeDrawer(changesDrawer);
      }
    });
    document.getElementById('rejectAllBtn').addEventListener('click', () => {
      if (activeProposal) {
        vscode.postMessage({ type: 'rejectEdit', proposalId: activeProposal.id });
        closeDrawer(changesDrawer);
      }
    });

    modelSelect.addEventListener('change', () => {
      selectedModelId = modelSelect.value;
      renderModelList();
      vscode.postMessage({ type: 'selectModel', model: selectedModelId });
    });
    function renderModelList() {
      modelSelect.replaceChildren(new Option('Automatic routing', 'auto'));
      availableModels.forEach(model => {
        const origin = model.source === 'remote' ? 'SSH / Remote' : model.source === 'local' || model.providerId === 'ollama' ? 'Local' : 'API';
        modelSelect.add(new Option((model.displayName || model.name) + ' · ' + origin, model.id || model.name));
      });
      const found = availableModels.find(model => (model.id || model.name) === selectedModelId);
      if (!found && selectedModelId !== 'auto') modelSelect.add(new Option('Unavailable: ' + selectedModelId, selectedModelId));
      modelSelect.value = selectedModelId;
      activeModelLabel.textContent = found ? found.displayName || found.name : 'Automatic routing';
      activeModelBadge.textContent = selectedModelId === 'auto' ? 'Auto' : !found ? 'Unavailable' : found.source === 'remote' ? 'Remote' : found.source === 'local' || found.providerId === 'ollama' ? 'Local' : 'API';
      activeModelBadge.className = 'model-badge';
    }

    let contextFiles = [];
    const attachedFiles = new Set();
    const filePicker = document.getElementById('filePicker');
    const fileFilter = document.getElementById('fileFilter');
    const chatHistory = document.getElementById('chatHistory');
    [filePicker, chatHistory].forEach(picker => {
      picker.addEventListener('toggle', () => {
        if (picker.open) [filePicker, chatHistory].filter(other => other !== picker).forEach(other => { other.open = false; });
      });
    });
    document.addEventListener('click', event => {
      [filePicker, chatHistory].forEach(picker => { if (!picker.contains(event.target)) picker.open = false; });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const picker = [filePicker, chatHistory].find(item => item.open);
      if (picker) { event.preventDefault(); picker.open = false; picker.querySelector('summary').focus(); }
    });
    filePicker.addEventListener('toggle', () => {
      if (filePicker.open) vscode.postMessage({ type: 'getContextFiles' });
    });
    fileFilter.addEventListener('input', renderFiles);
    function renderFiles() {
      const root = document.getElementById('fileList');
      root.replaceChildren();
      const filtered = contextFiles.filter(path => path.toLowerCase().includes(fileFilter.value.toLowerCase()));
      if (!filtered.length) root.textContent = 'No eligible workspace files. Refresh or open a trusted workspace.';
      filtered.forEach(path => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.path = path;
        checkbox.checked = attachedFiles.has(path);
        checkbox.disabled = isBusy || (!checkbox.checked && attachedFiles.size >= 10);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) attachedFiles.add(path); else attachedFiles.delete(path);
          renderAttachments();
          updateFileAvailability();
        });
        label.append(checkbox, document.createTextNode(path));
        root.appendChild(label);
      });
      renderAttachments();
    }
    function updateFileAvailability() {
      document.querySelectorAll('#fileList input').forEach(checkbox => {
        checkbox.disabled = isBusy || (!attachedFiles.has(checkbox.dataset.path) && attachedFiles.size >= 10);
      });
      document.querySelectorAll('#selectedFiles button').forEach(button => { button.disabled = isBusy; });
    }
    function renderAttachments() {
      const selected = document.getElementById('selectedFiles');
      selected.replaceChildren();
      attachedFiles.forEach(path => {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = path + ' ×';
        remove.setAttribute('aria-label', 'Remove attached file ' + path);
        remove.disabled = isBusy;
        remove.addEventListener('click', () => {
          attachedFiles.delete(path);
          const checkbox = Array.from(document.querySelectorAll('#fileList input')).find(input => input.dataset.path === path);
          if (checkbox) checkbox.checked = false;
          renderAttachments();
          updateFileAvailability();
          (selected.querySelector('button') || promptInput).focus();
        });
        selected.appendChild(remove);
      });
      document.getElementById('fileCount').textContent = attachedFiles.size ? '(' + attachedFiles.size + ')' : '';
    }
    function syncBusyControls() {
      if (!isBusy) cancellationRequested = false;
      if (sendBtn.disabled !== cancellationRequested) sendBtn.disabled = cancellationRequested;
      if (displayedBusy === isBusy) return;
      displayedBusy = isBusy;
      modelSelect.disabled = isBusy;
      effortSelect.disabled = isBusy;
      modeSelect.disabled = isBusy;
      accessScopeSelect.disabled = isBusy;
      document.querySelectorAll('.strat-btn, #newChatBtn, #clearChatBtn').forEach(button => { button.disabled = isBusy; });
      updateFileAvailability();
    }
    function requestCancellation() {
      if (!isBusy || cancellationRequested) return;
      cancellationRequested = true;
      sendBtn.textContent = 'Stopping…';
      footerStatusText.textContent = 'Cancellation requested…';
      syncBusyControls();
      vscode.postMessage({ type: 'cancel' });
    }

    // Ref Chips
    document.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', () => {
        const ref = c.getAttribute('data-ref');
        promptInput.value = (promptInput.value ? promptInput.value + ' ' : '') + ref + ' ';
        promptInput.focus();
      });
    });

    // Slash command autocomplete
    promptInput.addEventListener('input', () => {
      const val = promptInput.value;
      if (val.startsWith('/')) {
        slashPopup.classList.add('open');
      } else {
        slashPopup.classList.remove('open');
      }
    });

    document.querySelectorAll('.slash-item').forEach(item => {
      item.addEventListener('click', () => {
        const cmd = item.getAttribute('data-cmd');
        promptInput.value = cmd + ' ';
        slashPopup.classList.remove('open');
        promptInput.focus();
      });
    });

    // Send Message
    function sendMessage() {
      const text = promptInput.value.trim();
      if (!text || isBusy) return;
      promptInput.value = '';
      slashPopup.classList.remove('open');

      // Optimistically append user message bubble immediately
      const userCard = document.createElement('div');
      userCard.className = 'msg-user';
      userCard.textContent = text;
      mainScroll.appendChild(userCard);

      // Optimistically append thinking indicator immediately
      removeThinkingIndicator();
      const thinkingIndicator = document.createElement('div');
      thinkingIndicator.className = 'msg-assistant thinking-bubble';
      thinkingIndicator.id = 'active-thinking-indicator';
      thinkingIndicator.innerHTML = '<span class="thinking-spinner"></span><span>Sending request…</span>';
      mainScroll.appendChild(thinkingIndicator);
      scrollToLatest(true);

      isBusy = true;
      sendBtn.textContent = 'Cancel';
      footerStatusText.textContent = 'Sending request…';
      filePicker.open = false;
      syncBusyControls();

      vscode.postMessage({
        type: 'chat',
        model: selectedModelId || 'auto',
        prompt: text,
        files: Array.from(attachedFiles),
        includeContext: true,
        includeWorkspace: true,
        agentMode: currentMode === 'agent'
      });
    }

    function removeThinkingIndicator() {
      const existing = document.getElementById('active-thinking-indicator');
      if (existing) existing.remove();
    }

    sendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isBusy) {
        requestCancellation();
      } else {
        sendMessage();
      }
    });

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        sendMessage();
      }
      if (e.key === 'Escape') {
        if (slashPopup.classList.contains('open')) {
          slashPopup.classList.remove('open');
        } else if (isBusy) {
          requestCancellation();
        }
      }
    });

    let streamingBubble = null;
    let streamingText = '';
    let streamingFrame = null;
    function flushStreamingRender() {
      if (streamingFrame !== null) cancelAnimationFrame(streamingFrame);
      streamingFrame = null;
      if (streamingBubble) streamingBubble.innerHTML = renderMarkdown(streamingText);
    }
    function queueStreamingRender() {
      if (streamingFrame !== null) return;
      streamingFrame = requestAnimationFrame(() => {
        streamingFrame = null;
        if (streamingBubble) {
          streamingBubble.innerHTML = renderMarkdown(streamingText);
          scrollToLatest(false);
        }
      });
    }
    let followingLatest = true;

    function scrollToLatest(force) {
      if (!force && !followingLatest) {
        jumpToLatest.hidden = false;
        return;
      }
      mainScroll.scrollTop = mainScroll.scrollHeight;
      followingLatest = true;
      jumpToLatest.hidden = true;
    }

    mainScroll.addEventListener('scroll', () => {
      followingLatest = mainScroll.scrollHeight - mainScroll.scrollTop - mainScroll.clientHeight <= 72;
      jumpToLatest.hidden = followingLatest;
    });
    jumpToLatest.addEventListener('click', () => scrollToLatest(true));

    function renderActivity(act, historical) {
      if (!act || typeof act !== 'object') return;
      if (!historical && typeof act.title === 'string' && act.title.startsWith('Visible model update')) return;
      let row = act.id ? document.getElementById('act-row-' + act.id) : null;
      if (!row) {
        if (!historical && act.toolName && streamingBubble) {
          flushStreamingRender();
          streamingBubble.classList.remove('streaming');
          streamingBubble = null;
          streamingText = '';
        }
        row = document.createElement('div');
        row.className = 'timeline-row';
        if (act.id) row.id = 'act-row-' + act.id;
        (historical ? timelineContainer : mainScroll).appendChild(row);
      }
      row.setAttribute('data-status', act.status || 'success');
      const detailsOpen = !!row.querySelector('details')?.open;
      const symbol = act.status === 'running' || act.status === 'started' ? '◌' : act.status === 'error' ? '!' : act.status === 'waiting_for_approval' ? '?' : act.status === 'cancelled' ? '−' : '✓';
      const durationText = typeof act.durationMs === 'number' ? (act.durationMs / 1000).toFixed(1) + 's' : '';
      const detailSections = [];
      if (act.details) {
        const isModelResponse = typeof act.title === 'string' && act.title.startsWith('Visible model update');
        detailSections.push('<div><strong>' + (isModelResponse ? 'Model response · user-visible' : 'Details') + '</strong><pre>' + escapeHtml(act.details) + '</pre></div>');
      }
      if (act.inputSummary) detailSections.push('<div><strong>' + (act.toolName === 'run_command' ? 'Command and arguments' : 'Model tool input') + '</strong><pre>' + escapeHtml(act.inputSummary) + '</pre></div>');
      if (act.outputSummary) detailSections.push('<div><strong>' + (act.toolName === 'run_command' ? 'Command result' : 'Tool output') + '</strong><pre>' + escapeHtml(act.outputSummary) + '</pre></div>');
      const detailsMarkup = detailSections.length
        ? '<details class="timeline-details"' + (detailsOpen ? ' open' : '') + '><summary>Inspect run details</summary>' + detailSections.join('') + '</details>'
        : '';
      row.innerHTML = '<span class="activity-symbol" aria-label="' + escapeHtml(act.status || '') + '">' + symbol + '</span>' +
        '<span class="timeline-text">' + escapeHtml(act.title) + detailsMarkup + '</span><span class="activity-duration">' + durationText + '</span>';
      scrollToLatest(false);
    }

    // Inbound Messages
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'models') {
        availableModels = Array.isArray(msg.models) ? msg.models : [];
        if (msg.selectedModel) selectedModelId = msg.selectedModel;
        renderModelList();
      }
      if (msg.type === 'selectedModel') {
        selectedModelId = msg.model || 'auto';
        renderModelList();
      }
      if (msg.type === 'contextFiles') {
        contextFiles = Array.isArray(msg.files) ? msg.files : [];
        renderFiles();
      }

      if (msg.type === 'mode') {
        currentMode = msg.mode;
        modeSelect.value = currentMode;
      }

      if (msg.type === 'effort') {
        effortSelect.value = ['low', 'medium', 'high', 'ultra'].includes(msg.effort) ? msg.effort : 'medium';
      }

      if (msg.type === 'controlError') {
        footerStatusText.textContent = msg.message;
      }

      if (msg.type === 'strategy') {
        currentStrategy = msg.strategy;
        document.getElementById('stratFast')?.classList.toggle('active', currentStrategy === 'fast');
        document.getElementById('stratPlanning')?.classList.toggle('active', currentStrategy === 'planning');
      }

      if (msg.type === 'history') {
        flushStreamingRender();
        streamingBubble = null;
        streamingText = '';
        timelineContainer.innerHTML = '';
        timelineContainer.style.display = 'none';
        const oldMessages = mainScroll.querySelectorAll('.msg-user, .msg-assistant:not(.welcome), .artifact-card, .permission-card, .timeline-row');
        oldMessages.forEach(el => el.remove());
        if (Array.isArray(msg.messages) && msg.messages.length > 0) {
          msg.messages.forEach(m => {
            const card = document.createElement('div');
            card.className = m.role === 'user' ? 'msg-user' : 'msg-assistant';
            card.innerHTML = m.role === 'assistant' ? renderMarkdown(m.content) : escapeHtml(m.content).replace(/\\n/g, '<br>');
            mainScroll.appendChild(card);
          });
          scrollToLatest(true);
        }
      }

      if (msg.type === 'activeEditor') {
        activeFileName.textContent = msg.path ? msg.path : '';
      }

      if (msg.type === 'remoteStatus') {
        if (msg.connected) {
          remoteGpuStatus.textContent = '· SSH (' + (msg.profileName || 'DGX') + ')';
        } else {
          remoteGpuStatus.textContent = '';
        }
      }

      if (msg.type === 'status') {
        footerStatusText.textContent = cancellationRequested ? 'Cancellation requested…' : msg.message || 'Ready';
        if (msg.state === 'running' || msg.state === 'thinking') {
          isBusy = true;
          sendBtn.textContent = cancellationRequested ? 'Stopping…' : 'Cancel';
          const indicator = document.getElementById('active-thinking-indicator');
          if (indicator && msg.message) {
            const span = indicator.querySelector('span:last-child');
            if (span) span.textContent = msg.message;
          }
        } else {
          flushStreamingRender();
          isBusy = false;
          footerStatusText.textContent = msg.message || 'Ready';
          sendBtn.textContent = 'Send';
          removeThinkingIndicator();
          if (streamingBubble) {
            streamingBubble.classList.remove('streaming');
            streamingBubble = null;
            streamingText = '';
          }
        }
      }

      if (msg.type === 'permissionMode' && permissionModeSelect) {
        permissionModeSelect.value = msg.mode;
        permissionModeSelect.title = msg.workspaceSession ? 'Workspace commands and edits allowed for this chat. Internet, sensitive, destructive and privileged actions still need separate approval. Change this setting to revoke.' : '';
      }
      if (msg.type === 'sessions') {
        chats = Array.isArray(msg.sessions) ? msg.sessions : [];
        activeSessionId = msg.activeSessionId;
        const active = chats.find(chat => chat.id === activeSessionId);
        document.getElementById('sessionTitle').textContent = active?.title || '';
        renderChats();
      }

      if (msg.type === 'accessScope') {
        accessScopeSelect.value = msg.scope;
        accessScopeSelect.title = msg.filePath ? 'Restricted to ' + msg.filePath : msg.scope === 'machine' ? 'Outside-workspace reads need approval; workspace diffs remain workspace-only' : 'Workspace file tools; commands require separate approval';
      }
      if (msg.type === 'agentSettings') {
        if (msg.endpoints) { ollamaEndpointInput.value = msg.endpoints.ollama; compatibleEndpointsInput.value = msg.endpoints.compatible; }
        if (msg.workspaceIndex) {
          maxIndexedFiles.value = String(msg.workspaceIndex.maxIndexedFiles);
          maxFileBytes.value = String(msg.workspaceIndex.maxFileBytes);
          maxIndexCharacters.value = String(msg.workspaceIndex.maxIndexCharacters);
        }
        if (msg.chatMemory) {
          chatMemoryEnabled.checked = msg.chatMemory.enabled;
          chatMemoryScope.value = msg.chatMemory.scope;
          recentChatBudget.value = String(msg.chatMemory.recentCharacters);
          retrievedChatBudget.value = String(msg.chatMemory.retrievedCharacters);
          chatMemoryCount.value = String(msg.chatMemory.resultCount);
        }
        agentRoundsInput.value = String(msg.maxRounds);
        ollamaContextInput.value = String(msg.contextWindow);
        ollamaOutputInput.value = String(msg.maxOutputTokens);
      }
      if (msg.type === 'providerStatus') {
        document.getElementById('providerStatus').textContent = (msg.pending ? 'Endpoint changes pending until active work finishes.\\n' : '') + (msg.errors || []).join('\\n') + ((msg.errors || []).length ? '\\n' : '') + (msg.providers || []).map(provider => (provider.endpoint || provider.id) + ' · ' + (provider.isReachable === true ? 'Ready' : provider.isReachable === false ? 'Unavailable' : 'Checking') + ' · ' + (provider.modelCount || 0) + ' model(s)' + (provider.error ? ' · ' + provider.error : '')).join('\\n');
      }
      if (msg.type === 'indexStatus') {
        const status = msg.status;
        const restricted = msg.scope === 'file';
        document.getElementById('workspaceIndexStatus').textContent = restricted ? 'File access: workspace retrieval is disabled' : !status ? 'No workspace index available' : status.state + ' · ' + status.fileCount + ' files / ' + status.chunkCount + ' chunks' + (status.limitReached ? ' · Partial coverage: limit reached' : '') + (status.lastIndexed ? ' · Updated ' + new Date(status.lastIndexed).toLocaleTimeString() : '') + (status.error ? ' · ' + status.error : '');
        document.getElementById('rebuildWorkspaceIndex').disabled = restricted || !status || status.state === 'indexing' || status.state === 'updating';
      }

      if (msg.type === 'activityHistory') {
        timelineContainer.innerHTML = '';
        const activities = Array.isArray(msg.activities) ? msg.activities : [];
        if (activities.length) {
          timelineContainer.style.display = 'flex';
          const archive = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = 'Previous run details';
          archive.appendChild(summary);
          timelineContainer.appendChild(archive);
          activities.forEach(act => renderActivity(act, true));
          timelineContainer.querySelectorAll('.timeline-row').forEach(row => archive.appendChild(row));
        }
      }

      if (msg.type === 'activity') {
        renderActivity(msg.activity);
      }

      if (msg.type === 'chunk') {
        removeThinkingIndicator();
        if (!streamingBubble) {
          streamingBubble = document.createElement('div');
          streamingBubble.className = 'msg-assistant streaming';
          mainScroll.appendChild(streamingBubble);
          streamingText = '';
        }
        streamingText += msg.content;
        queueStreamingRender();
      }

      if (msg.type === 'proposal') {
        const displayedProposal = msg.proposal;
        activeProposal = msg.proposal;
        changesBadge.textContent = String(activeProposal.files.length);
        proposalSummary.textContent = activeProposal.summary + ' (' + activeProposal.files.length + ' files)';
        diffFileList.innerHTML = '';
        activeProposal.files.forEach(f => {
          const item = document.createElement('div');
          item.className = 'diff-item';
          const operation = f.moveSourcePath ? 'Move destination' : f.moveDestinationPath ? 'Move source' : f.operation === 'delete' ? 'Delete' : f.operation === 'create' ? 'Create' : 'Edit';
          item.innerHTML = '<span>' + escapeHtml(operation) + ' · ' + escapeHtml(f.path) + '</span>' +
            '<div class="diff-stats"><span class="stat-add">+' + f.additions + '</span><span class="stat-del">-' + f.deletions + '</span></div>';
          item.addEventListener('click', () => {
            vscode.postMessage({ type: 'showDiff', proposalId: displayedProposal.id, filePath: f.path });
          });
          diffFileList.appendChild(item);
        });

        // In-feed review card
        const card = document.createElement('div');
        card.className = 'artifact-card';
        card.innerHTML = '<div class="artifact-header">' +
          '<div class="artifact-title"><span>Changes: ' + activeProposal.files.length + ' file(s) changed (+' + activeProposal.additions + ' -' + activeProposal.deletions + ')</span></div>' +
          '<span class="model-badge">Review</span></div>' +
          '<div class="artifact-body">' +
          activeProposal.files.map(f => '<div>' + escapeHtml(f.moveSourcePath ? 'Move destination' : f.moveDestinationPath ? 'Move source' : f.operation === 'delete' ? 'Delete' : f.operation === 'create' ? 'Create' : 'Edit') + ' · ' + escapeHtml(f.path) + ' <span class="stat-add">+' + f.additions + '</span> <span class="stat-del">-' + f.deletions + '</span></div>').join('') +
          '</div>' +
          '<div class="artifact-actions">' +
          '<button class="action-btn" id="apply-all-' + activeProposal.id + '">Accept changes</button>' +
          '<button class="action-btn secondary" id="review-diff-' + activeProposal.id + '">Review diff</button>' +
          '<button class="action-btn secondary" id="reject-' + activeProposal.id + '">Reject</button>' +
          '</div>';
        mainScroll.appendChild(card);
        scrollToLatest(false);

        const applyBtn = document.getElementById('apply-all-' + activeProposal.id);
        if (applyBtn) {
          applyBtn.addEventListener('click', () => {
            if (!isBusy) vscode.postMessage({ type: 'applyEdit', proposalId: displayedProposal.id });
            card.remove();
          });
        }
        const reviewBtn = document.getElementById('review-diff-' + activeProposal.id);
        if (reviewBtn) {
          reviewBtn.addEventListener('click', () => {
            openDrawer(changesDrawer);
            if (activeProposal.files.length > 0) {
              vscode.postMessage({ type: 'showDiff', proposalId: displayedProposal.id, filePath: displayedProposal.files[0].path });
            }
          });
        }
        const rejectBtn = document.getElementById('reject-' + activeProposal.id);
        if (rejectBtn) {
          rejectBtn.addEventListener('click', () => {
            if (!isBusy) vscode.postMessage({ type: 'rejectEdit', proposalId: displayedProposal.id });
            card.remove();
          });
        }
      }

      if (msg.type === 'editRecovery') {
        const list = document.getElementById('recoveryList');
        list.replaceChildren();
        const records = Array.isArray(msg.records) ? msg.records : [];
        if (!records.length) list.textContent = 'No recorded changes.';
        records.forEach(record => {
          const row = document.createElement('div');
          row.style.cssText = 'padding:10px 0; border-top:1px solid var(--border);';
          const title = document.createElement('div');
          title.textContent = record.summary;
          const meta = document.createElement('div');
          meta.style.cssText = 'color:var(--subtle); margin:4px 0; overflow-wrap:anywhere;';
          meta.textContent = record.status.replace(/_/g, ' ') + ' · ' + record.remainingFiles.length + ' recoverable file(s) · ' + new Date(record.createdAt).toLocaleString();
          const paths = document.createElement('div');
          paths.textContent = record.files.join(', ');
          paths.style.cssText = 'font-size:11px; color:var(--subtle); overflow-wrap:anywhere; margin-bottom:6px;';
          row.append(title, meta, paths);
          if (record.remainingFiles.length) {
            const undo = document.createElement('button');
            undo.className = 'action-btn secondary';
            undo.textContent = 'Undo recorded edit';
            undo.onclick = () => { if (!isBusy) vscode.postMessage({ type: 'rollbackEdit', recoveryId: record.id }); };
            row.appendChild(undo);
          }
          const forget = document.createElement('button');
          forget.className = 'action-btn secondary';
          forget.style.marginLeft = '6px';
          forget.textContent = 'Remove backup';
          forget.onclick = () => { if (!isBusy) vscode.postMessage({ type: 'forgetEditRecovery', recoveryId: record.id }); };
          row.appendChild(forget);
          list.appendChild(row);
        });
      }

      if (msg.type === 'recoveryResult') {
        const result = document.createElement('div');
        result.className = 'msg-assistant';
        result.style.whiteSpace = 'pre-wrap';
        result.textContent = msg.summary || 'Recovery finished.';
        mainScroll.appendChild(result);
        scrollToLatest(false);
      }

      if (msg.type === 'permissionCancelled') {
        document.getElementById('perm-' + msg.requestId)?.remove();
      }

      if (msg.type === 'permissionDecision') {
        document.getElementById('perm-' + msg.requestId)?.remove();
      }

      if (msg.type === 'permissionRequest') {
        const req = msg.request;
        document.getElementById('perm-' + req.id)?.remove();
        const card = document.createElement('div');
        card.className = 'permission-card';
        card.id = 'perm-' + req.id;
        card.innerHTML = '<div class="permission-title"><span>' + escapeHtml(req.description || 'Allow this action?') + '</span></div>' +
          (req.command ? '<div class="permission-desc">' + escapeHtml(req.commandCategory || 'Command') + ' · runs in the current workspace</div><pre class="permission-command">' + escapeHtml(req.command) + '</pre>' :
            req.path ? '<div class="permission-desc">File: ' + escapeHtml(req.path) + '</div>' :
              '<div class="permission-desc">' + escapeHtml(req.description || req.category || 'Review this action before allowing it.') + '</div>') +
          (req.scriptPreview ? '<div class="permission-desc">Declared package lifecycle scripts (may execute arbitrary code)</div><pre class="permission-command">' + escapeHtml(req.scriptPreview) + '</pre>' : '') +
          '<div class="permission-actions">' +
          '<button class="action-btn" id="allow-' + req.id + '">Allow</button>' +
          '<button class="action-btn secondary" id="deny-' + req.id + '">Deny</button>' +
          (req.workspaceSessionAvailable ? '<button class="action-btn secondary" type="button" id="allow-session-' + req.id + '">Allow commands & edits for this chat</button>' : '') +
          (req.workspaceSessionAvailable ? '<div class="permission-desc">Project commands can execute arbitrary code as your OS user. Internet, sensitive reads, destructive and privileged actions still need separate approval. New chat or changed scope revokes this grant.</div>' : '') +
          '</div>';
        mainScroll.appendChild(card);
        scrollToLatest(true);

        const decide = (event, decision) => {
          event.preventDefault();
          event.stopPropagation();
          card.querySelectorAll('button').forEach(button => { button.disabled = true; });
          vscode.postMessage({ type: 'permissionResolved', requestId: req.id, decision });
        };
        document.getElementById('allow-' + req.id)?.addEventListener('click', event => decide(event, 'allow'));
        document.getElementById('deny-' + req.id)?.addEventListener('click', event => decide(event, 'deny'));
        document.getElementById('allow-session-' + req.id)?.addEventListener('click', event => decide(event, 'allow_session'));
      }

      if (msg.type === 'artifact') {
        const art = msg.artifact;
        const card = document.createElement('div');
        card.className = 'artifact-card';
        card.setAttribute('data-artifact-id', art.id);
        card.innerHTML = '<div class="artifact-header">' +
          '<div class="artifact-title"><span>' + escapeHtml(art.type) + '</span></div>' +
          '<span class="model-badge">' + escapeHtml(art.status) + '</span></div>' +
          '<div class="artifact-body">' + escapeHtml(art.content) + '</div>' +
          '<div class="artifact-actions">' +
          (art.type === 'Implementation Plan' ? '<button class="action-btn" id="proceed-' + art.id + '">Proceed</button>' : '') +
          '</div>';
        mainScroll.appendChild(card);
        scrollToLatest(false);

        const proceedBtn = document.getElementById('proceed-' + art.id);
        if (proceedBtn) {
          proceedBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'proceedArtifact', artifactId: art.id });
          });
        }
      }

      if (msg.type === 'artifactUpdated' && msg.artifact) {
        const cards = mainScroll.querySelectorAll('.artifact-card');
        cards.forEach(function (c) {
          if (c.getAttribute('data-artifact-id') === msg.artifact.id) {
            const badge = c.querySelector('.model-badge');
            if (badge) { badge.textContent = msg.artifact.status; }
            if (msg.artifact.status === 'approved') {
              const btn = c.querySelector('button.action-btn');
              if (btn) { btn.disabled = true; btn.textContent = 'Approved'; }
            }
          }
        });
      }

      if (msg.type === 'editResult') {
        const card = document.createElement('div');
        card.className = 'msg-assistant';
        const ok = !!msg.success;
        const applied = msg.applied === undefined ? ok : !!msg.applied;
        const label = applied ? msg.validationPassed === false ? 'Changes applied · checks failed' : 'Changes applied' : 'Changes not applied';
        const color = applied ? msg.validationPassed === false ? 'var(--vscode-editorWarning-foreground, #cca700)' : 'var(--vscode-testing-iconPassed, #73c991)' : 'var(--vscode-errorForeground, #f48771)';
        card.style.borderLeft = '3px solid ' + color;
        card.innerHTML = '<div style=\"font-weight:600; margin-bottom:4px;\">' + label + '</div>' +
          '<div style=\"font-size:12px; line-height:1.4;\">' + escapeHtml(msg.summary || '') + '</div>';
        mainScroll.appendChild(card);
        scrollToLatest(false);
        if (!activeProposal || !msg.proposalId || activeProposal.id === msg.proposalId) {
          activeProposal = null;
          changesBadge.textContent = '0';
          proposalSummary.textContent = 'No pending changes';
          diffFileList.innerHTML = '';
        }
      }

      if (msg.type === 'userMessage') {
        const userCards = mainScroll.querySelectorAll('.msg-user');
        const lastUserCard = userCards[userCards.length - 1];
        if (!lastUserCard || lastUserCard.textContent !== msg.content) {
          const card = document.createElement('div');
          card.className = 'msg-user';
          card.textContent = msg.content;
          mainScroll.appendChild(card);
          scrollToLatest(false);
        }
      }

      if (msg.type === 'done') {
        flushStreamingRender();
        isBusy = false;
        sendBtn.textContent = 'Send';
        removeThinkingIndicator();
        if (streamingBubble) {
          streamingBubble.classList.remove('streaming');
          streamingBubble.innerHTML = renderMarkdown(msg.fullResponse || streamingText);
          streamingBubble = null;
          streamingText = '';
        } else if (msg.fullResponse) {
          const card = document.createElement('div');
          card.className = 'msg-assistant';
          card.innerHTML = renderMarkdown(msg.fullResponse);
          mainScroll.appendChild(card);
        }
        scrollToLatest(false);
      }

      if (msg.type === 'error') {
        flushStreamingRender();
        isBusy = false;
        sendBtn.textContent = 'Send';
        removeThinkingIndicator();
        if (streamingBubble) {
          streamingBubble.classList.remove('streaming');
          streamingBubble = null;
          streamingText = '';
        }
        const card = document.createElement('div');
        card.className = 'msg-assistant';
        card.style.borderLeft = '3px solid var(--vscode-errorForeground, #f48771)';
        card.style.background = 'rgba(244, 135, 113, 0.08)';
        const isConnError = msg.message && (msg.message.includes('Ollama') || msg.message.includes('connect') || msg.message.includes('fetch'));
        card.innerHTML = '<div style="color:var(--vscode-errorForeground, #f48771); font-weight:600; margin-bottom:4px;">Task Failed</div>' +
          '<div style="font-size:12px; line-height:1.4;">' + escapeHtml(msg.message || 'Unknown error') + '</div>' +
          (isConnError ? '<div style="margin-top:8px; font-size:11px; opacity:0.85;">Tip: Ensure Ollama is running (\\'ollama serve\\'). Try running <code>TuxNest: Doctor</code> from the command palette.</div>' : '');
        mainScroll.appendChild(card);
        scrollToLatest(false);
      }
      syncBusyControls();
    });

    function escapeHtml(str) {
      return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderMarkdown(value) {
      return (${renderChatMarkdown.toString()})((${normalizeAssistantMarkdown.toString()})(value));
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
