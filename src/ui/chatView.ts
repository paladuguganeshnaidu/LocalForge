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

export class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private readonly conversations = new Map<string, ChatMessage[]>();
  private busy = false;
  private activeInteraction?: symbol;
  private activeChat?: AbortController;
  private remoteSession?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string };
  public selectedModel?: string;
  public activeMode: AgentMode = 'agent';
  public activeStrategy: ExecutionStrategy = 'planning';
  private engine?: LocalForgeEngine;
  private currentProposal?: EditProposal;
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
    if (this.engine) {
      this.initPermissionHandler();
    }
    const saved = this.context.workspaceState.get<Record<string, ChatMessage[]>>('localforge.conversations', {});
    if (saved && typeof saved === 'object') {
      for (const [key, msgs] of Object.entries(saved)) {
        if (Array.isArray(msgs)) {
          this.conversations.set(key, msgs.filter((m) => m && typeof m.content === 'string' && typeof m.role === 'string'));
        }
      }
    }
  }

  public setEngine(engine: LocalForgeEngine): void {
    this.engine = engine;
    this.initPermissionHandler();
  }

  private initPermissionHandler(): void {
    if (!this.engine) return;
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
  }

  private postPermissionRequest(request: PermissionRequest): void {
    this.post({
      type: 'permissionRequest',
      request: {
        id: request.id,
        toolName: request.toolName,
        category: request.category,
        commandCategory: request.commandCategory,
        description: request.description,
        command: request.command,
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

    if (decision === 'allow_session') this.setPermissionMode('ask_once_per_session');

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

    pending.resolve(decision === 'allow' || decision === 'allow_session');
  }

  private setPermissionMode(mode: PermissionMode): void {
    this.engine?.permissionManager.setMode(mode);
    void this.context.globalState?.update('localforge.permissionMode', mode);
    this.post({ type: 'permissionMode', mode });
  }

  public modelForTask(task: ModelTask): string | undefined {
    const configuration = vscode.workspace.getConfiguration('localforge.routing');
    const preferences: Record<ModelTask, string> = {
      chat: configuration.get<string>('chatModel', ''),
      edit: configuration.get<string>('editModel', ''),
      agent: configuration.get<string>('agentModel', ''),
      completion: configuration.get<string>('completionModel', '')
    };
    return routeModel(this.models, task, preferences, this.selectedModel)?.id || routeModel(this.models, task, preferences, this.selectedModel)?.name;
  }

  public setRemoteSession(session?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string }): void {
    this.remoteSession = session;
    void this.postRemoteStatus();
  }

  public async postRemoteStatus(): Promise<void> {
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

  public setSelectedModel(model: string): void {
    this.selectedModel = model;
    this.post({ type: 'selectedModel', model });
    this.post({ type: 'history', messages: this.conversations.get(model) ?? [] });
    this.postActivityHistory();
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

  private saveConversations(): void {
    const obj: Record<string, ChatMessage[]> = {};
    for (const [key, value] of this.conversations.entries()) {
      obj[key] = value.slice(-40).map((m) => ({ role: m.role, content: m.content }));
    }
    void this.context.workspaceState.update('localforge.conversations', obj);
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    view.webview.html = getHtml(view.webview, this.context.extensionUri);

    view.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
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
        console.warn('[LocalForge] Received unrecognized webview message:', message);
        return;
      }

      if (message.type === 'ready' || message.type === 'refresh') {
        await this.refresh();
      }

      if (message.type === 'setMode') {
        this.activeMode = message.mode;
        this.post({ type: 'mode', mode: this.activeMode });
      }

      if (message.type === 'setStrategy') {
        this.activeStrategy = message.strategy;
        this.post({ type: 'strategy', strategy: this.activeStrategy });
      }

      if (message.type === 'selectModel') {
        this.selectedModel = message.model;
        const history = this.conversations.get(this.selectedModel ?? '') ?? [];
        this.post({ type: 'history', messages: history });
        this.postActivityHistory();
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

      if (message.type === 'diagnose') {
        await vscode.commands.executeCommand('localforge.diagnose');
      }

      if (message.type === 'continueTask') {
        await vscode.commands.executeCommand('localforge.continueTask');
      }

      if (message.type === 'clear') {
        if (this.selectedModel) {
          this.conversations.delete(this.selectedModel);
          this.saveConversations();
        }
        this.post({ type: 'history', messages: [] });
      }

      if (message.type === 'newSession') {
        if (this.engine) {
          this.engine.sessionManager.createNewSession();
          this.engine.permissionManager.clearSession();
        }
        if (this.selectedModel) {
          this.conversations.delete(this.selectedModel);
          this.saveConversations();
        }
        await this.refresh();
        this.post({ type: 'history', messages: [] });
      }

      if (message.type === 'loadSession') {
        if (this.engine && message.sessionId) {
          await this.engine.sessionManager.setActiveSession(message.sessionId);
          this.engine.permissionManager.clearSession();
          await this.refresh();
        }
      }

      if (message.type === 'deleteSession') {
        if (this.engine && message.sessionId) {
          this.engine.sessionManager.deleteSession(message.sessionId);
          this.engine.permissionManager.clearSession();
          await this.refresh();
        }
      }

      if (message.type === 'updateSettings') {
        if (message.settings && typeof message.settings === 'object') {
          const config = vscode.workspace.getConfiguration('localforge');
          for (const [key, val] of Object.entries(message.settings)) {
            void config.update(key, val, vscode.ConfigurationTarget.Global);
          }
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
    });
  }

  public async refresh(): Promise<void> {
    try {
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

      const history = this.conversations.get(this.selectedModel ?? '') ?? [];
      this.post({ type: 'history', messages: history });
      this.postActivityHistory();
      await this.postRemoteStatus();

      if (vscode.window.activeTextEditor) {
        this.postActiveEditor(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri));
      }

      this.post({
        type: 'status',
        state: 'ready',
        message: `${this.models.length} model(s) available`
      });
      this.post({ type: 'permissionMode', mode: this.engine?.permissionManager.getMode() ?? 'always_ask' });
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
  }): Promise<void> {
    if (this.busy) {
      console.warn('[LocalForge] Cancelling prior in-flight task for incoming prompt.');
      this.cancelActiveChat();
    }
    const interaction = Symbol('chat');
    this.activeInteraction = interaction;
    this.busy = true;

    const modelName = (message.model && message.model !== 'auto')
      ? message.model
      : (this.selectedModel && this.selectedModel !== 'auto' ? this.selectedModel : '');
    const mode = this.activeMode;
    const history = this.conversations.get(modelName) ?? [];
    let finalStatusMessage = 'Ready';

    this.post({ type: 'status', state: 'thinking', message: 'Analyzing task...' });
    this.post({ type: 'userMessage', content: message.prompt });

    try {
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
              this.post({ type: 'activity', activity });
            },
            onArtifact: (artifact: Artifact) => {
              this.post({ type: 'artifact', artifact });
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
        } else if (summary.errors?.length) {
          finalStatusMessage = 'Completed with tool warnings';
        }

        history.push({ role: 'user', content: message.prompt });
        history.push({ role: 'assistant', content: summary.response });
        this.conversations.set(modelName, history);
        this.saveConversations();

        this.post({ type: 'done', fullResponse: summary.response });
      } else {
        // Fallback direct provider streaming
        this.activeChat = new AbortController();
        let full = '';
        const messages: ChatMessage[] = [
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

        history.push({ role: 'user', content: message.prompt });
        history.push({ role: 'assistant', content: full });
        this.conversations.set(modelName, history);
        this.saveConversations();

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
  const logoUri = extensionUri && typeof webview.asWebviewUri === 'function'
    ? webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'lomvren-icon.png')).toString()
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --editor-bg: var(--vscode-editor-background, #1e1e1e));
      --fg: var(--vscode-foreground, #cccccc);
      --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.2)));
      --accent: var(--vscode-button-background, #1a73e8);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --input-bg: var(--vscode-input-background, #252526);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --subtle: var(--vscode-descriptionForeground, #888888);
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --success: #34a853;
      --warning: #fbbc04;
      --error: #ea4335;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font: 12.5px/1.5 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      user-select: none;
    }
    button:focus-visible, select:focus-visible, textarea:focus-visible, [role="button"]:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, #1a73e8);
      outline-offset: 2px;
    }
    .msg-user, .msg-assistant, .artifact-body, .permission-command, textarea { user-select: text; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
      }
    }

    /* SVG Icons */
    .icon {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      flex-shrink: 0;
    }

    /* Top Header */
    .header {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      flex-shrink: 0;
      padding: 10px 12px;
      gap: 8px;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-title {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: -0.2px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .icon-btn {
      background: transparent;
      border: 0;
      color: var(--subtle);
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }
    .icon-btn:hover {
      color: var(--fg);
      background: var(--card-bg);
    }

    /* Model Chip & Selector */
    .model-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 11.5px;
      cursor: pointer;
      color: var(--fg);
    }
    .model-chip:hover { border-color: var(--accent); }
    .model-info-left {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .model-badge {
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      text-transform: uppercase;
    }
    .model-badge.remote {
      background: #0284c7;
      color: #ffffff;
    }

    /* Segmented Mode Selector */
    .mode-bar {
      display: flex;
      padding: 8px 12px;
      background: var(--bg);
      gap: 6px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .mode-btn {
      flex: 1;
      border: 1px solid transparent;
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 500;
      background: transparent;
      color: var(--subtle);
      border-radius: 8px;
      cursor: pointer;
      text-align: center;
      transition: all 0.12s;
    }
    .mode-btn:hover { color: var(--fg); }
    .mode-btn.active {
      background: var(--card-bg);
      color: var(--fg);
      border-color: var(--border);
      font-weight: 600;
    }
    .strategy-toggle {
      display: flex;
      border-left: 1px solid var(--border);
      padding-left: 6px;
      gap: 3px;
      align-items: center;
    }
    .strat-btn {
      border: 1px solid transparent;
      background: transparent;
      color: var(--subtle);
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
    }
    .strat-btn.active {
      background: var(--card-bg);
      border-color: var(--border);
      color: var(--fg);
      font-weight: 600;
    }

    /* Conversation & Activity Area */
    .conversation-area {
      flex: 1;
      min-height: 0;
      position: relative;
      display: flex;
    }
    .main-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      user-select: text;
    }
    .jump-latest {
      position: absolute;
      right: 18px;
      bottom: 12px;
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 6px 11px;
      color: var(--fg);
      background: var(--card-bg);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
      cursor: pointer;
      z-index: 2;
    }
    .jump-latest[hidden] { display: none; }
    .jump-latest:hover { border-color: var(--accent); }

    /* Timeline & Activity */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 4px;
      border-left: 2px solid var(--border);
      margin-left: 6px;
      padding-left: 10px;
    }
    .timeline-row {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 11.5px;
      color: var(--subtle);
      padding: 2px 0;
    }
    .timeline-cat {
      font-weight: 600;
      color: var(--fg);
      min-width: 60px;
    }
    .timeline-details { margin-top: 3px; font-size: 10.5px; }
    .timeline-details summary { cursor: pointer; color: var(--subtle); }
    .timeline-details div { padding: 5px 7px; margin-top: 3px; border-left: 2px solid var(--border); }
    .timeline-details pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0 0; font: inherit; max-height: 260px; overflow: auto; }
    .timeline-text {
      flex: 1;
      word-break: break-word;
    }
    .timeline-status {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
      white-space: nowrap;
    }
    .timeline-status.started, .timeline-status.running {
      background: var(--card-bg);
      color: var(--accent);
    }
    .timeline-status.success {
      background: rgba(46, 160, 67, 0.15);
      color: var(--success);
    }
    .timeline-status.warning {
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
    }
    .timeline-status.error, .timeline-status.failed {
      background: rgba(248, 81, 73, 0.15);
      color: var(--error);
    }
    .timeline-status.cancelled { background: var(--card-bg); color: var(--subtle); }
    .timeline-status.waiting_for_approval {
      background: rgba(210, 153, 34, 0.15);
      color: #d29922;
    }
    .msg-assistant.streaming::after {
      content: ' ▌';
      animation: blink 1s step-start infinite;
      color: var(--accent);
    }
    @keyframes blink { 50% { opacity: 0; } }

    /* Message Cards */
    .msg-user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--accent-fg);
      padding: 8px 12px;
      border-radius: 16px 16px 4px 16px;
      max-width: 90%;
      word-break: break-word;
      font-size: 12.5px;
    }
    .msg-assistant {
      align-self: flex-start;
      background: var(--card-bg);
      color: var(--fg);
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid var(--border);
      max-width: 100%;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.55;
    }
    .msg-assistant p { margin: 0 0 8px; }
    .msg-assistant p:last-child { margin-bottom: 0; }
    .msg-assistant h1, .msg-assistant h2, .msg-assistant h3 { margin: 8px 0 4px; font-size: 1.05em; }
    .msg-assistant ul { margin: 4px 0 8px 18px; }
    .msg-assistant pre { overflow-x: auto; padding: 8px; margin: 6px 0; background: var(--input-bg); border-radius: 8px; }
    .msg-assistant code { font-family: var(--vscode-editor-font-family, Consolas, monospace); }
    .msg-assistant p code { padding: 1px 3px; background: var(--input-bg); border-radius: 3px; }
    .msg-assistant.thinking-bubble {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-style: italic;
      color: var(--subtle);
      border: 1px dashed var(--border);
      background: var(--card-bg);
      padding: 8px 12px;
      font-size: 12px;
    }
    .thinking-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: lf-spin 0.8s linear infinite;
      display: inline-block;
      flex-shrink: 0;
    }
    @keyframes lf-spin {
      to { transform: rotate(360deg); }
    }

    /* Interactive Artifact Card */
    .artifact-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--bg);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .artifact-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 12px;
    }
    .artifact-title {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .artifact-body {
      font-size: 11.5px;
      color: var(--fg);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-family: inherit;
      background: var(--card-bg);
      padding: 8px;
      border-radius: 8px;
    }
    .artifact-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .action-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 0;
      border-radius: 8px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      min-height: 28px;
      transition: filter 0.15s, background 0.15s;
    }
    .action-btn:hover:not(:disabled), .send-btn:hover:not(:disabled) { filter: brightness(1.08); }
    .action-btn.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .action-btn.secondary:hover { background: var(--card-bg); }

    /* Permission Request Card */
    .permission-card {
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: 12px;
      background: var(--card-bg);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11.5px;
    }
    .permission-title {
      font-weight: 600;
      color: var(--fg);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .permission-desc {
      color: var(--subtle);
      font-family: monospace;
      font-size: 11px;
      word-break: break-all;
      background: var(--bg);
      padding: 4px 6px;
      border-radius: 6px;
    }
    .permission-command {
      margin: 0;
      padding: 7px;
      max-height: 160px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--fg);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      font: 11px var(--vscode-editor-font-family, monospace);
    }
    .permission-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    /* Bottom Utility Toolbar */
    .toolbar-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      background: var(--bg);
      border-top: 1px solid var(--border);
      font-size: 11px;
      color: var(--subtle);
      flex-shrink: 0;
    }
    .toolbar-items {
      display: flex;
      gap: 8px;
    }
    .toolbar-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      border: 0;
      color: var(--subtle);
      font-size: 11px;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 8px;
    }
    .toolbar-btn:hover {
      color: var(--fg);
      background: var(--card-bg);
    }
    .toolbar-count {
      font-weight: 600;
      padding: 0 4px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      border-radius: 3px;
      font-size: 10px;
    }

    /* Composer */
    .composer {
      padding: 8px 12px 10px;
      background: var(--bg);
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }
    .ref-chips {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .chip {
      font-size: 10.5px;
      color: var(--subtle);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 2px 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .chip:hover {
      color: var(--fg);
      border-color: var(--accent);
    }
    .composer-input-box {
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--input-bg);
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }
    .composer-input-box:focus-within {
      border-color: var(--accent);
    }
    textarea {
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--input-fg);
      font-family: inherit;
      font-size: 12.5px;
      resize: none;
      min-height: 44px;
      max-height: 160px;
      line-height: 1.4;
    }
    .composer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 4px;
      border-top: 1px solid rgba(128,128,128,0.1);
    }
    .composer-bottom-left {
      font-size: 11px;
      color: var(--subtle);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .send-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 0;
      border-radius: 8px;
      padding: 4px 12px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      transition: filter 0.15s;
    }
    .send-btn:disabled { opacity: 0.5; cursor: default; }

    /* Slash Auto-complete Popup */
    .slash-popup {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      display: none;
      flex-direction: column;
      margin-bottom: 4px;
      overflow: hidden;
      z-index: 50;
    }
    .slash-popup.open { display: flex; }
    .slash-item {
      padding: 6px 10px;
      font-size: 11.5px;
      display: flex;
      justify-content: space-between;
      cursor: pointer;
      color: var(--fg);
    }
    .slash-item:hover, .slash-item.selected {
      background: var(--accent);
      color: var(--accent-fg);
    }

    /* Drawers (Review Changes, Terminal, Settings) */
    .drawer {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--bg);
      z-index: 100;
      display: none;
      flex-direction: column;
      overflow-y: auto;
      padding: 12px;
      gap: 12px;
    }
    .drawer.open { display: flex; }
    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    .drawer-title {
      font-weight: 600;
      font-size: 13px;
    }
    .diff-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .diff-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 11.5px;
      font-family: monospace;
      cursor: pointer;
    }
    .diff-item:hover { border-color: var(--accent); }
    .diff-stats {
      font-size: 11px;
      display: flex;
      gap: 6px;
    }
    .stat-add { color: var(--success); font-weight: 600; }
    .stat-del { color: var(--error); font-weight: 600; }

    /* Model Picker Modal */
    .modal-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-overlay.open { display: flex; }
    .modal-box {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      width: 100%;
      max-width: 380px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }
    .modal-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 12px;
    }
    .model-list {
      overflow-y: auto;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .model-option {
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      border: 1px solid transparent;
    }
    .model-option:hover {
      background: var(--card-bg);
      border-color: var(--border);
    }
    .model-option.selected {
      background: var(--card-bg);
      border-color: var(--accent);
    }
    .model-opt-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
      font-size: 12px;
    }
    .model-opt-meta {
      font-size: 11px;
      color: var(--subtle);
      display: flex;
      gap: 8px;
    }

    /* Terminal Output Container */
    .terminal-box {
      background: #000000;
      color: #00ff66;
      font-family: monospace;
      font-size: 11px;
      padding: 8px;
      border-radius: 4px;
      max-height: 250px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="header-top">
      <div class="header-title" style="display:flex; align-items:center; gap:7px;">
        ${logoUri ? `<img src="${logoUri}" alt="LOMVREN" style="width:18px; height:18px; border-radius:4px; object-fit:contain;" />` : ''}
        <span>LOMVREN</span>
        <span id="sessionTitle" style="color:var(--subtle); font-weight:normal;"></span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="newChatBtn" title="New Session">
          <svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button class="icon-btn" id="refreshBtn" title="Refresh Models">
          <svg class="icon" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        </button>
        <button class="icon-btn" id="diagnoseBtn" title="Diagnose Installation">
          <svg class="icon" viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        </button>
        <button class="icon-btn" id="settingsBtn" title="Settings">
          <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>
    <!-- Model Chip -->
    <div class="model-chip" id="modelChipBtn" title="Click to choose model">
      <div class="model-info-left">
        <span id="activeModelLabel">Auto</span>
        <span class="model-badge" id="activeModelBadge">Local</span>
        <span id="remoteGpuStatus" style="font-size:10.5px; color:var(--subtle);"></span>
      </div>
      <svg class="icon" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
    </div>
  </div>

  <!-- Mode Selector -->
  <div class="mode-bar">
    <button class="mode-btn" data-mode="ask" id="modeAsk">Ask</button>
    <button class="mode-btn" data-mode="plan" id="modePlan">Plan</button>
    <button class="mode-btn active" data-mode="agent" id="modeAgent">Agent</button>
    <div class="strategy-toggle">
      <button class="strat-btn" id="stratFast" title="Direct execution for small tasks">Fast</button>
      <button class="strat-btn active" id="stratPlanning" title="Plan and verify major changes">Planning</button>
    </div>
  </div>

  <!-- Conversation & Activity Scroll Area -->
  <div class="conversation-area">
    <div class="main-scroll" id="mainScroll">
    <div class="msg-assistant welcome" style="display:flex; gap:10px; align-items:center;">
      ${logoUri ? `<img src="${logoUri}" alt="LOMVREN Logo" style="width:34px; height:34px; border-radius:6px; object-fit:contain; flex-shrink:0;" />` : ''}
      <div>
        <strong>LOMVREN</strong><br>
        <span style="font-size:11px; opacity:0.85;">Local AI coding agent · chat, plans, and reviewable changes.</span>
      </div>
    </div>
    <div class="timeline" id="timelineContainer" style="display:none;"></div>
    </div>
    <button class="jump-latest" id="jumpToLatest" type="button" hidden aria-label="Jump to latest activity">↓ Latest</button>
  </div>

  <!-- Bottom Utility Toolbar -->
  <div class="toolbar-bar">
    <div class="toolbar-items">
      <button class="toolbar-btn" id="openChangesBtn">
        <svg class="icon" viewBox="0 0 24 24"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/></svg>
        <span>Changes</span>
        <span class="toolbar-count" id="changesBadge">0</span>
      </button>
      <button class="toolbar-btn" id="openTerminalBtn">
        <svg class="icon" viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span>Terminal</span>
        <span class="toolbar-count" id="terminalBadge">0</span>
      </button>
    </div>
    <div id="footerStatusText">Ready</div>
  </div>

  <!-- Composer Area -->
  <div class="composer">
    <div class="ref-chips">
      <span class="chip" data-ref="@file">@file</span>
      <span class="chip" data-ref="@selection">@selection</span>
      <span class="chip" data-ref="@terminal">@terminal</span>
      <span class="chip" data-ref="@diagnostics">@diagnostics</span>
      <span class="chip" data-ref="@git">@git</span>
    </div>
    <div class="composer-input-box">
      <!-- Slash Command Autocomplete Popup -->
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
      <textarea id="promptInput" placeholder="Type a task, question, or / for commands..."></textarea>
      <div class="composer-bottom">
        <div class="composer-bottom-left">
          <span id="activeFileName"></span>
        </div>
        <button type="button" class="send-btn" id="sendBtn">Send</button>
      </div>
    </div>
  </div>

  <!-- Review Changes Drawer -->
  <div class="drawer" id="changesDrawer">
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
  <div class="drawer" id="terminalDrawer">
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
  <div class="drawer" id="settingsDrawer">
    <div class="drawer-header">
      <div class="drawer-title">LOMVREN Settings</div>
      <button class="icon-btn" id="closeSettingsBtn">
        <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div style="display:flex; flex-direction:column; gap:8px;">
      <span style="font-size:11px; text-transform:uppercase; color:var(--subtle); font-weight:600;">Endpoints</span>
      <div style="background:var(--card-bg); padding:8px; border-radius:4px; font-size:11.5px; display:flex; justify-content:space-between;">
        <span>Ollama Endpoint</span>
        <span style="font-family:monospace; color:var(--subtle);">http://127.0.0.1:11434</span>
      </div>
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
    </div>
  </div>

  <!-- Model Picker Modal -->
  <div class="modal-overlay" id="modelModal">
    <div class="modal-box">
      <div class="modal-header">
        <span>Select Model</span>
        <button class="icon-btn" id="closeModelModalBtn">
          <svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="model-list" id="modelModalList"></div>
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
        console.warn('[LOMVREN] acquireVsCodeApi reuse or error:', err);
        return window.__cachedVsCodeApi || { postMessage: function() {} };
      }
    })();

    const mainScroll = document.getElementById('mainScroll');
    const jumpToLatest = document.getElementById('jumpToLatest');
    const timelineContainer = document.getElementById('timelineContainer');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const slashPopup = document.getElementById('slashPopup');
    const modelChipBtn = document.getElementById('modelChipBtn');
    const modelModal = document.getElementById('modelModal');
    const modelModalList = document.getElementById('modelModalList');
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
    const permissionModeSelect = document.getElementById('permissionModeSelect');
    const diffFileList = document.getElementById('diffFileList');
    const proposalSummary = document.getElementById('proposalSummary');
    const terminalOutput = document.getElementById('terminalOutput');
    const terminalCommandLabel = document.getElementById('terminalCommandLabel');

    let currentMode = 'agent';
    let currentStrategy = 'planning';
    let isBusy = false;
    let availableModels = [];
    let selectedModelId = 'auto';
    let activeProposal = null;

    // Mode Buttons
    ['ask', 'plan', 'agent'].forEach(mode => {
      const btn = document.getElementById('mode' + mode.charAt(0).toUpperCase() + mode.slice(1));
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = mode;
        vscode.postMessage({ type: 'setMode', mode });
      });
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
      settingsDrawer.classList.add('open');
    });
    permissionModeSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'setPermissionMode', mode: permissionModeSelect.value });
    });
    document.getElementById('closeSettingsBtn').addEventListener('click', () => {
      settingsDrawer.classList.remove('open');
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
      changesDrawer.classList.add('open');
    });
    document.getElementById('closeChangesBtn').addEventListener('click', () => {
      changesDrawer.classList.remove('open');
    });
    document.getElementById('openTerminalBtn').addEventListener('click', () => {
      terminalDrawer.classList.add('open');
    });
    document.getElementById('closeTerminalBtn').addEventListener('click', () => {
      terminalDrawer.classList.remove('open');
    });

    // Proposal Actions
    document.getElementById('acceptAllBtn').addEventListener('click', () => {
      if (activeProposal) {
        vscode.postMessage({ type: 'applyEdit', proposalId: activeProposal.id });
        changesDrawer.classList.remove('open');
      }
    });
    document.getElementById('rejectAllBtn').addEventListener('click', () => {
      if (activeProposal) {
        vscode.postMessage({ type: 'rejectEdit', proposalId: activeProposal.id });
        changesDrawer.classList.remove('open');
      }
    });

    // Model Picker Modal
    modelChipBtn.addEventListener('click', () => {
      renderModelList();
      modelModal.classList.add('open');
    });
    document.getElementById('closeModelModalBtn').addEventListener('click', () => {
      modelModal.classList.remove('open');
    });

    function renderModelList() {
      modelModalList.innerHTML = '';

      // Auto Option
      const autoDiv = document.createElement('div');
      autoDiv.className = 'model-option' + (selectedModelId === 'auto' ? ' selected' : '');
      autoDiv.innerHTML = '<div class="model-opt-header"><span>Auto</span><span class="model-badge">Smart</span></div>' +
        '<div class="model-opt-meta"><span>Capability-based task router</span></div>';
      autoDiv.addEventListener('click', () => {
        selectedModelId = 'auto';
        activeModelLabel.textContent = 'Auto';
        activeModelBadge.textContent = 'Local';
        activeModelBadge.className = 'model-badge';
        modelModal.classList.remove('open');
        vscode.postMessage({ type: 'selectModel', model: 'auto' });
      });
      modelModalList.appendChild(autoDiv);

      availableModels.forEach(m => {
        const div = document.createElement('div');
        const id = m.id || m.name;
        div.className = 'model-option' + (selectedModelId === id ? ' selected' : '');
        const isRemote = m.source === 'remote';
        div.innerHTML = '<div class="model-opt-header"><span>' + escapeHtml(m.displayName || m.name) + '</span>' +
          '<span class="model-badge' + (isRemote ? ' remote' : '') + '">' + (isRemote ? 'Remote' : 'Local') + '</span></div>' +
          '<div class="model-opt-meta"><span>' + escapeHtml(m.providerId) + '</span>' +
          (m.capabilities?.toolCalling ? '<span>Tools</span>' : '') +
          (m.capabilities?.codeCompletion ? '<span>Fast Coder</span>' : '') +
          '</div>';
        div.addEventListener('click', () => {
          selectedModelId = id;
          activeModelLabel.textContent = m.displayName || m.name;
          activeModelBadge.textContent = isRemote ? 'Remote' : 'Local';
          activeModelBadge.className = 'model-badge' + (isRemote ? ' remote' : '');
          modelModal.classList.remove('open');
          vscode.postMessage({ type: 'selectModel', model: id });
        });
        modelModalList.appendChild(div);
      });
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
      if (!text) return;
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
      thinkingIndicator.innerHTML = '<span class="thinking-spinner"></span><span>Planning your request...</span>';
      mainScroll.appendChild(thinkingIndicator);
      scrollToLatest(true);

      isBusy = true;
      sendBtn.textContent = 'Cancel';
      footerStatusText.textContent = 'Analyzing task...';

      vscode.postMessage({
        type: 'chat',
        model: selectedModelId || 'auto',
        prompt: text,
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
      if (sendBtn.textContent === 'Cancel') {
        vscode.postMessage({ type: 'cancel' });
        isBusy = false;
        sendBtn.textContent = 'Send';
        removeThinkingIndicator();
      } else {
        isBusy = false;
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
        } else if (sendBtn.textContent === 'Cancel') {
          vscode.postMessage({ type: 'cancel' });
          isBusy = false;
          sendBtn.textContent = 'Send';
          removeThinkingIndicator();
        }
      }
    });

    let streamingBubble = null;
    let streamingText = '';
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

    function renderActivity(act) {
      if (!act || typeof act !== 'object') return;
      timelineContainer.style.display = 'flex';
      let row = act.id ? document.getElementById('act-row-' + act.id) : null;
      if (!row) {
        row = document.createElement('div');
        row.className = 'timeline-row';
        if (act.id) row.id = 'act-row-' + act.id;
        timelineContainer.appendChild(row);
      }
      const detailsOpen = !!row.querySelector('details')?.open;
      const statusClass = act.status ? ' timeline-status ' + act.status : '';
      const statusBadge = act.status ? '<span class="' + statusClass + '">' + escapeHtml(act.status) + '</span>' : '';
      const durationText = act.durationMs ? ' (' + (act.durationMs / 1000).toFixed(1) + 's)' : '';
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
      row.innerHTML = '<span class="timeline-cat">' + escapeHtml(act.category) + '</span>' +
        '<span class="timeline-text">' + escapeHtml(act.title) + durationText + detailsMarkup + '</span>' + statusBadge;
      scrollToLatest(false);
    }

    // Inbound Messages
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'models') {
        availableModels = msg.models || [];
        if (msg.selectedModel) {
          selectedModelId = msg.selectedModel;
          const found = availableModels.find(m => (m.id || m.name) === selectedModelId);
          if (found) {
            activeModelLabel.textContent = found.displayName || found.name;
            activeModelBadge.textContent = found.source === 'remote' ? 'Remote' : 'Local';
            activeModelBadge.className = 'model-badge' + (found.source === 'remote' ? ' remote' : '');
          }
        }
        renderModelList();
      }

      if (msg.type === 'selectedModel') {
        selectedModelId = msg.model || 'auto';
        const found = availableModels.find(m => (m.id || m.name) === selectedModelId);
        activeModelLabel.textContent = found ? found.displayName || found.name : 'Auto';
        activeModelBadge.textContent = found?.source === 'remote' ? 'Remote' : 'Local';
        activeModelBadge.className = 'model-badge' + (found?.source === 'remote' ? ' remote' : '');
        renderModelList();
      }


      if (msg.type === 'mode') {
        currentMode = msg.mode;
        document.querySelectorAll('.mode-btn').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-mode') === currentMode);
        });
      }

      if (msg.type === 'strategy') {
        currentStrategy = msg.strategy;
        document.getElementById('stratFast')?.classList.toggle('active', currentStrategy === 'fast');
        document.getElementById('stratPlanning')?.classList.toggle('active', currentStrategy === 'planning');
      }

      if (msg.type === 'history') {
        timelineContainer.innerHTML = '';
        timelineContainer.style.display = 'none';
        const oldMessages = mainScroll.querySelectorAll('.msg-user, .msg-assistant:not(.welcome), .artifact-card, .permission-card');
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
        footerStatusText.textContent = msg.message || 'Ready';
        if (msg.state === 'running' || msg.state === 'thinking') {
          isBusy = true;
          sendBtn.textContent = 'Cancel';
          const indicator = document.getElementById('active-thinking-indicator');
          if (indicator && msg.message) {
            const span = indicator.querySelector('span:last-child');
            if (span) span.textContent = msg.message;
          }
        } else {
          isBusy = false;
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
      }

      if (msg.type === 'activityHistory') {
        timelineContainer.innerHTML = '';
        (Array.isArray(msg.activities) ? msg.activities : []).forEach(renderActivity);
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
        streamingBubble.innerHTML = renderMarkdown(streamingText);
        scrollToLatest(false);
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
            changesDrawer.classList.add('open');
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

      if (msg.type === 'permissionRequest') {
        const req = msg.request;
        document.getElementById('perm-' + req.id)?.remove();
        const card = document.createElement('div');
        card.className = 'permission-card';
        card.id = 'perm-' + req.id;
        card.innerHTML = '<div class="permission-title"><span>Permission Request: ' + escapeHtml(req.toolName) + '</span></div>' +
          (req.command ? '<div class="permission-desc">' + escapeHtml(req.commandCategory || 'Command') + ' · runs in the current workspace</div><pre class="permission-command">' + escapeHtml(req.command) + '</pre>' :
            req.path ? '<div class="permission-desc">File: ' + escapeHtml(req.path) + '</div>' :
              '<div class="permission-desc">' + escapeHtml(req.description || req.category || 'Review this action before allowing it.') + '</div>') +
          '<div class="permission-actions">' +
          '<button class="action-btn" id="allow-' + req.id + '">Allow</button>' +
          '<button class="action-btn secondary" id="deny-' + req.id + '">Deny</button>' +
          '<button class="action-btn secondary" id="allow-session-' + req.id + '">Allow for Session</button>' +
          '</div>';
        mainScroll.appendChild(card);
        scrollToLatest(true);

        document.getElementById('allow-' + req.id)?.addEventListener('click', () => {
          vscode.postMessage({ type: 'permissionResolved', requestId: req.id, decision: 'allow' });
          card.remove();
        });
        document.getElementById('deny-' + req.id)?.addEventListener('click', () => {
          vscode.postMessage({ type: 'permissionResolved', requestId: req.id, decision: 'deny' });
          card.remove();
        });
        document.getElementById('allow-session-' + req.id)?.addEventListener('click', () => {
          vscode.postMessage({ type: 'permissionResolved', requestId: req.id, decision: 'allow_session' });
          card.remove();
        });
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
          (isConnError ? '<div style="margin-top:8px; font-size:11px; opacity:0.85;">Tip: Ensure Ollama is running (\\'ollama serve\\'). Try running <code>LOMVREN: Doctor</code> from the command palette.</div>' : '');
        mainScroll.appendChild(card);
        scrollToLatest(false);
      }
    });

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderMarkdown(value) {
      const lines = String(value || '').replace(/\\r/g, '').split('\\n');
      const blocks = [];
      let paragraph = [];
      let code = [];
      let inCode = false;
      const codeFence = String.fromCharCode(96, 96, 96);
      const inline = (text) => escapeHtml(text)
        .replace(new RegExp(String.fromCharCode(96) + '([^' + String.fromCharCode(96) + ']+)' + String.fromCharCode(96), 'g'), '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
        .replace(/\\*([^*]+)\\*/g, '<em>$1</em>');
      const flushParagraph = () => {
        if (paragraph.length) {
          blocks.push('<p>' + paragraph.map(inline).join('<br>') + '</p>');
          paragraph = [];
        }
      };
      for (const line of lines) {
        if (line.startsWith(codeFence)) {
          if (inCode) {
            blocks.push('<pre><code>' + escapeHtml(code.join('\\n')) + '</code></pre>');
            code = [];
            inCode = false;
          } else {
            flushParagraph();
            inCode = true;
          }
          continue;
        }
        if (inCode) { code.push(line); continue; }
        if (!line.trim()) { flushParagraph(); continue; }
        const heading = /^(#{1,3})\\s+(.+)$/.exec(line);
        if (heading) {
          flushParagraph();
          const level = heading[1].length;
          blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
          continue;
        }
        if (/^[-*]\\s+/.test(line)) {
          flushParagraph();
          blocks.push('<ul><li>' + inline(line.replace(/^[-*]\\s+/, '')) + '</li></ul>');
          continue;
        }
        paragraph.push(line);
      }
      if (inCode) blocks.push('<pre><code>' + escapeHtml(code.join('\\n')) + '</code></pre>');
      flushParagraph();
      return blocks.join('');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
