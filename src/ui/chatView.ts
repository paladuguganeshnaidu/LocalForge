import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ChatMessage, LocalModel, ModelProvider } from '../providers/modelProvider';
import { AgentMode } from '../agent/agentLoop';
import { SshOllamaTunnel } from '../remote/sshOllamaTunnel';
import { isWebviewMessage, WebviewMessage } from './webviewMessages';
import { LocalForgeEngine } from '../core/LocalForgeEngine';
import { ModelTask, routeModel } from '../providers/modelRouter';
import { EditProposal } from '../editing/editEngine';
import { Artifact } from '../core/artifactManager';
import { TurnActivity, ExecutionStrategy } from '../core/turnManager';

export class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private readonly conversations = new Map<string, ChatMessage[]>();
  private busy = false;
  private activeChat?: AbortController;
  private remoteSession?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string };
  public selectedModel?: string;
  public activeMode: AgentMode = 'agent';
  public activeStrategy: ExecutionStrategy = 'planning';
  private engine?: LocalForgeEngine;
  private currentProposal?: EditProposal;

  constructor(
    private readonly provider: ModelProvider,
    private readonly context: vscode.ExtensionContext,
    engine?: LocalForgeEngine
  ) {
    this.engine = engine;
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
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = getHtml(view.webview);

    view.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      if (!isWebviewMessage(message)) return;

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

      if (message.type === 'cancel') {
        this.cancelActiveChat();
      }

      if (message.type === 'openFile') {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root && message.filePath) {
          try {
            const uri = vscode.Uri.joinPath(root, message.filePath);
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
          const res = await this.engine.editEngine.applyProposal(message.proposalId, message.files);
          this.post({
            type: 'editResult',
            success: res.failedCount === 0 && res.staleCount === 0,
            summary: `Applied changes to ${res.appliedCount} file(s).`
          });
          this.post({ type: 'activity', activity: {
            id: `act-${Date.now()}`,
            category: 'Applying changes',
            title: `Applied ${res.appliedCount} file(s) safely`,
            status: res.failedCount === 0 ? 'success' : 'error',
            timestamp: Date.now()
          }});
        }
      }

      if (message.type === 'rejectEdit') {
        if (this.engine && message.proposalId) {
          this.engine.editEngine.rejectProposal(message.proposalId);
          this.post({ type: 'editResult', success: false, summary: 'Proposed edits discarded.' });
          this.post({ type: 'activity', activity: {
            id: `act-${Date.now()}`,
            category: 'Cancelled',
            title: 'Proposal rejected by user',
            status: 'error',
            timestamp: Date.now()
          }});
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

      if (message.type === 'chat') {
        await this.handleChatMessage(message);
      }
    });
  }

  public async refresh(): Promise<void> {
    try {
      if (this.engine) {
        this.models = this.engine.modelRegistry.getModels();
      } else {
        this.models = await this.provider.listModels();
      }

      if (!this.selectedModel && this.models.length > 0) {
        this.selectedModel = this.models[0].id || this.models[0].name;
      }

      this.post({
        type: 'models',
        models: this.models,
        selectedModel: this.selectedModel
      });

      const history = this.conversations.get(this.selectedModel ?? '') ?? [];
      this.post({ type: 'history', messages: history });
      await this.postRemoteStatus();

      if (vscode.window.activeTextEditor) {
        this.postActiveEditor(vscode.workspace.asRelativePath(vscode.window.activeTextEditor.document.uri));
      }

      this.post({
        type: 'status',
        state: 'ready',
        message: `${this.models.length} model(s) available`
      });
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
    this.busy = false;
    this.post({ type: 'status', state: 'ready', message: 'Ready' });
    this.post({ type: 'activity', activity: {
      id: `act-${Date.now()}`,
      category: 'Cancelled',
      title: 'Task cancelled by user',
      status: 'error',
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
    model: string;
    prompt: string;
    includeContext: boolean;
    includeWorkspace: boolean;
    agentMode: boolean;
  }): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    const modelName = message.model || this.selectedModel || '';
    const mode = this.activeMode;
    const history = this.conversations.get(modelName) ?? [];

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
              this.post({ type: 'status', state: 'running', message: progress });
            },
            onToken: (token) => {
              this.post({ type: 'chunk', content: token });
            },
            onActivity: (activity: TurnActivity) => {
              this.post({ type: 'activity', activity });
            },
            onArtifact: (artifact: Artifact) => {
              this.post({ type: 'artifact', artifact });
            }
          }
        );

        // Check for pending proposals in the edit engine
        const pending = this.engine.editEngine.getPendingProposals();
        if (pending.length > 0) {
          const latest = pending[0];
          this.post({ type: 'proposal', proposal: latest });
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
            full += token;
            this.post({ type: 'chunk', content: token });
          },
          this.activeChat.signal
        );

        history.push({ role: 'user', content: message.prompt });
        history.push({ role: 'assistant', content: full });
        this.conversations.set(modelName, history);
        this.saveConversations();

        this.post({ type: 'done', fullResponse: full });
      }
    } catch (error: any) {
      const errMsg = error?.name === 'AbortError' ? 'Task cancelled.' : error?.message || 'Request failed';
      this.post({ type: 'error', message: errMsg });
    } finally {
      this.busy = false;
      this.activeChat = undefined;
      this.post({ type: 'status', state: 'ready', message: 'Ready' });
    }
  }

  private post(msg: Record<string, unknown>): void {
    void this.view?.webview.postMessage(msg);
  }
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
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --editor-bg: var(--vscode-editor-background, #1e1e1e));
      --fg: var(--vscode-foreground, #cccccc);
      --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128,128,128,0.2)));
      --accent: var(--vscode-button-background, #0e639c);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --input-bg: var(--vscode-input-background, #252526);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --subtle: var(--vscode-descriptionForeground, #888888);
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
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
      padding: 8px 12px;
      gap: 6px;
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
      border-radius: 4px;
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
      padding: 4px 8px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
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
      padding: 6px 12px;
      background: var(--bg);
      gap: 4px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .mode-btn {
      flex: 1;
      border: 1px solid transparent;
      padding: 4px 6px;
      font-size: 11px;
      font-weight: 500;
      background: transparent;
      color: var(--subtle);
      border-radius: 4px;
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
    .main-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      user-select: text;
    }

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
    .timeline-text {
      flex: 1;
      word-break: break-word;
    }

    /* Message Cards */
    .msg-user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--accent-fg);
      padding: 8px 12px;
      border-radius: 8px 8px 2px 8px;
      max-width: 90%;
      word-break: break-word;
      font-size: 12.5px;
    }
    .msg-assistant {
      align-self: flex-start;
      background: var(--card-bg);
      color: var(--fg);
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      max-width: 100%;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.55;
    }

    /* Interactive Artifact Card */
    .artifact-card {
      border: 1px solid var(--border);
      border-radius: 6px;
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
      border-radius: 4px;
    }
    .artifact-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .action-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 0;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .action-btn.secondary {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
    }
    .action-btn.secondary:hover { background: var(--card-bg); }

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
      border-radius: 3px;
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
      border-radius: 3px;
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
      border-radius: 6px;
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
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
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
      <div class="header-title">
        <span>LocalForge</span>
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
  <div class="main-scroll" id="mainScroll">
    <div class="msg-assistant">
      <strong>LocalForge 0.1.6</strong><br>
      Local-first AI software engineer for VS Code. Select a mode or type a task below.
    </div>
    <div class="timeline" id="timelineContainer" style="display:none;"></div>
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
        <button class="send-btn" id="sendBtn">Send</button>
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
      <div class="drawer-title">LocalForge Settings</div>
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
    const vscode = acquireVsCodeApi();

    const mainScroll = document.getElementById('mainScroll');
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
      vscode.postMessage({ type: 'clear' });
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
      if (!text || isBusy) return;
      promptInput.value = '';
      slashPopup.classList.remove('open');
      vscode.postMessage({
        type: 'chat',
        model: selectedModelId,
        prompt: text,
        includeContext: true,
        includeWorkspace: true,
        agentMode: currentMode === 'agent'
      });
    }

    sendBtn.addEventListener('click', () => {
      if (isBusy) {
        vscode.postMessage({ type: 'cancel' });
      } else {
        sendMessage();
      }
    });

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      if (e.key === 'Escape') {
        if (slashPopup.classList.contains('open')) {
          slashPopup.classList.remove('open');
        } else if (isBusy) {
          vscode.postMessage({ type: 'cancel' });
        }
      }
    });

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
        } else {
          isBusy = false;
          sendBtn.textContent = 'Send';
        }
      }

      if (msg.type === 'activity') {
        const act = msg.activity;
        timelineContainer.style.display = 'flex';
        const row = document.createElement('div');
        row.className = 'timeline-row';
        row.innerHTML = '<span class="timeline-cat">' + escapeHtml(act.category) + '</span>' +
          '<span class="timeline-text">' + escapeHtml(act.title) + '</span>';
        timelineContainer.appendChild(row);
        mainScroll.scrollTop = mainScroll.scrollHeight;
      }

      if (msg.type === 'proposal') {
        activeProposal = msg.proposal;
        changesBadge.textContent = String(activeProposal.files.length);
        proposalSummary.textContent = activeProposal.summary + ' (' + activeProposal.files.length + ' files)';
        diffFileList.innerHTML = '';
        activeProposal.files.forEach(f => {
          const item = document.createElement('div');
          item.className = 'diff-item';
          item.innerHTML = '<span>' + escapeHtml(f.path) + '</span>' +
            '<div class="diff-stats"><span class="stat-add">+' + f.additions + '</span><span class="stat-del">-' + f.deletions + '</span></div>';
          item.addEventListener('click', () => {
            vscode.postMessage({ type: 'showDiff', proposalId: activeProposal.id, filePath: f.path });
          });
          diffFileList.appendChild(item);
        });
      }

      if (msg.type === 'artifact') {
        const art = msg.artifact;
        const card = document.createElement('div');
        card.className = 'artifact-card';
        card.innerHTML = '<div class="artifact-header">' +
          '<div class="artifact-title"><span>' + escapeHtml(art.type) + '</span></div>' +
          '<span class="model-badge">' + escapeHtml(art.status) + '</span></div>' +
          '<div class="artifact-body">' + escapeHtml(art.content) + '</div>' +
          '<div class="artifact-actions">' +
          (art.type === 'Implementation Plan' ? '<button class="action-btn" id="proceed-' + art.id + '">Proceed</button>' : '') +
          '</div>';
        mainScroll.appendChild(card);
        mainScroll.scrollTop = mainScroll.scrollHeight;

        const proceedBtn = document.getElementById('proceed-' + art.id);
        if (proceedBtn) {
          proceedBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'proceedArtifact', artifactId: art.id });
          });
        }
      }

      if (msg.type === 'userMessage') {
        const card = document.createElement('div');
        card.className = 'msg-user';
        card.textContent = msg.content;
        mainScroll.appendChild(card);
        mainScroll.scrollTop = mainScroll.scrollHeight;
      }

      if (msg.type === 'done') {
        const card = document.createElement('div');
        card.className = 'msg-assistant';
        card.innerHTML = escapeHtml(msg.fullResponse).replace(/\\n/g, '<br>');
        mainScroll.appendChild(card);
        mainScroll.scrollTop = mainScroll.scrollHeight;
      }
    });

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
