import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { ChatMessage, LocalModel, ModelProvider } from '../providers/modelProvider';
import { AgentMode } from '../agent/agentLoop';
import { SshOllamaTunnel } from '../remote/sshOllamaTunnel';
import { isWebviewMessage, WebviewMessage } from './webviewMessages';
import { LocalForgeEngine } from '../core/LocalForgeEngine';
import { ModelTask, routeModel } from '../providers/modelRouter';
import { EditProposal } from '../editing/editEngine';

export class LocalForgeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private models: LocalModel[] = [];
  private readonly conversations = new Map<string, ChatMessage[]>();
  private busy = false;
  private activeChat?: AbortController;
  private remoteSession?: { tunnel: SshOllamaTunnel; providerId: string; profileName: string };
  public selectedModel?: string;
  public activeMode: AgentMode = 'agent';
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
    return routeModel(this.models, task, preferences, this.selectedModel)?.name;
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
        }
      }

      if (message.type === 'rejectEdit') {
        if (this.engine && message.proposalId) {
          this.engine.editEngine.rejectProposal(message.proposalId);
          this.post({ type: 'editResult', success: false, summary: 'Proposed edits discarded.' });
        }
      }

      if (message.type === 'chat') {
        await this.handleChatMessage(message);
      }
    });
  }

  public async refresh(): Promise<void> {
    try {
      this.models = await this.provider.listModels();
      if (!this.selectedModel && this.models.length > 0) {
        this.selectedModel = this.models[0].name;
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
  }

  public async sendUserPrompt(prompt: string, options: { includeContext?: boolean; mode?: AgentMode } = {}): Promise<void> {
    if (!this.selectedModel && this.models.length > 0) {
      this.selectedModel = this.models[0].name;
    }
    if (options.mode) {
      this.activeMode = options.mode;
      this.post({ type: 'mode', mode: this.activeMode });
    }
    await this.handleChatMessage({
      type: 'chat',
      model: this.selectedModel ?? '',
      prompt,
      includeContext: options.includeContext ?? true,
      includeWorkspace: true,
      agentMode: this.activeMode === 'agent'
    });
  }

  private async handleChatMessage(message: {
    type?: string;
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
          (progress) => {
            this.post({ type: 'status', state: 'running', message: progress });
            this.post({ type: 'activity', text: progress });
          },
          (token) => {
            this.post({ type: 'chunk', content: token });
          }
        );

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
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-widget-border, rgba(128,128,128,0.2));
      --accent: var(--vscode-button-background, #007acc);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --subtle: var(--vscode-descriptionForeground);
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08));
    }
    * { box-sizing: border-box; }
    body {
      padding: 0;
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font: 13px/1.5 var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Minimal Header */
    .top-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      flex-shrink: 0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 7px;
      font-weight: 600;
      font-size: 12.5px;
      letter-spacing: -0.2px;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
    }
    .status-dot.busy { background: #f59e0b; animation: pulse 1s infinite; }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .icon-btn {
      background: transparent;
      border: 0;
      color: var(--subtle);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .icon-btn:hover {
      color: var(--fg);
      background: var(--card-bg);
    }

    /* Segmented Mode Selector */
    .mode-bar {
      display: flex;
      margin: 8px 12px;
      background: var(--card-bg);
      padding: 2px;
      border-radius: 6px;
      gap: 2px;
      flex-shrink: 0;
    }
    .mode-btn {
      flex: 1;
      border: 0;
      padding: 5px 6px;
      font-size: 11.5px;
      font-weight: 500;
      background: transparent;
      color: var(--subtle);
      border-radius: 4px;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }
    .mode-btn:hover { color: var(--fg); }
    .mode-btn.active {
      background: var(--bg);
      color: var(--fg);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }

    /* Conversation Area */
    .chat-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
    }
    .msg-user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--accent-fg);
      padding: 8px 12px;
      border-radius: 12px 12px 2px 12px;
      max-width: 85%;
      word-break: break-word;
    }
    .msg-assistant {
      align-self: flex-start;
      background: var(--card-bg);
      color: var(--fg);
      padding: 10px 14px;
      border-radius: 12px 12px 12px 2px;
      max-width: 95%;
      word-break: break-word;
      border: 1px solid var(--border);
    }
    .activity-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--subtle);
      padding: 2px 6px;
      background: var(--card-bg);
      border-radius: 4px;
      margin: 2px 0;
    }

    /* Composer / Proposal Cards */
    .proposal-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      background: var(--bg);
      margin: 8px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .proposal-header {
      font-weight: 600;
      font-size: 12px;
      display: flex;
      justify-content: space-between;
    }
    .file-diff-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      background: var(--card-bg);
      border-radius: 4px;
      font-size: 11.5px;
      font-family: monospace;
    }
    .proposal-actions {
      display: flex;
      gap: 6px;
    }

    /* Bottom Input Container */
    .bottom-container {
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--bg);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }
    .context-pill {
      font-size: 11px;
      color: var(--subtle);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .input-box {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--input-bg);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.15s;
    }
    .input-box:focus-within {
      border-color: var(--accent);
    }
    textarea {
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--input-fg);
      font-family: inherit;
      font-size: 13px;
      resize: none;
      min-height: 48px;
      max-height: 180px;
    }
    .input-bottom-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    select.model-select {
      background: transparent;
      border: 0;
      color: var(--subtle);
      font-size: 11.5px;
      cursor: pointer;
      outline: 0;
      max-width: 160px;
      text-overflow: ellipsis;
    }
    select.model-select:hover { color: var(--fg); }
    .send-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: 0;
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .send-btn:disabled { opacity: 0.5; cursor: default; }

    /* Settings Overlay */
    .settings-drawer {
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
      padding: 16px;
      gap: 16px;
    }
    .settings-drawer.open { display: flex; }
    .setting-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .setting-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--subtle);
    }
    .setting-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px;
      background: var(--card-bg);
      border-radius: 6px;
      font-size: 12px;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="top-header">
    <div class="brand">
      <span class="status-dot" id="statusDot"></span>
      <span>LocalForge</span>
      <span id="remoteBadge" style="font-size:10.5px; color:var(--subtle); font-weight:normal;"></span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="newChatBtn" title="New Session">➕</button>
      <button class="icon-btn" id="diagnoseBtn" title="Installation Diagnostics">🛠️</button>
      <button class="icon-btn" id="settingsBtn" title="Settings">⚙️</button>
      <button class="icon-btn" id="refreshBtn" title="Refresh Models">🔄</button>
    </div>
  </div>

  <!-- Segmented Mode Bar -->
  <div class="mode-bar">
    <button class="mode-btn active" data-mode="agent" id="modeAgent">⚡ Agent</button>
    <button class="mode-btn" data-mode="plan" id="modePlan">📋 Plan</button>
    <button class="mode-btn" data-mode="ask" id="modeAsk">💬 Ask</button>
  </div>

  <!-- Chat Log -->
  <div class="chat-scroll" id="chatFeed">
    <div class="msg-card">
      <div class="msg-assistant">
        <strong>LocalForge 0.1.5</strong><br>
        Local-first AI software engineer. Running on your machine or private GPU.
      </div>
    </div>
  </div>

  <!-- Bottom Bar -->
  <div class="bottom-container">
    <div class="context-pill" id="contextPill">
      <span>📁 Workspace Active</span>
      <span id="activeFilePath"></span>
    </div>
    <div class="input-box">
      <textarea id="promptInput" placeholder="Ask a question, propose a plan, or ask Agent to build a feature..."></textarea>
      <div class="input-bottom-row">
        <select class="model-select" id="modelSelect" title="Select Model"></select>
        <button class="send-btn" id="sendBtn">Send</button>
      </div>
    </div>
  </div>

  <!-- Settings Drawer -->
  <div class="settings-drawer" id="settingsDrawer">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <h3 style="margin:0; font-size:14px;">LocalForge Settings</h3>
      <button class="icon-btn" id="closeSettingsBtn" style="font-size:14px;">✕</button>
    </div>

    <div class="setting-group">
      <div class="setting-title">Runtimes & Endpoints</div>
      <div class="setting-item">
        <span>Ollama Endpoint</span>
        <span style="font-family:monospace; color:var(--subtle);">http://127.0.0.1:11434</span>
      </div>
      <div class="setting-item">
        <span>OpenAI Endpoint</span>
        <button class="send-btn" style="padding:3px 8px; font-size:11px;" id="cfgOpenAiBtn">Configure</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-title">Remote GPU & SSH</div>
      <div class="setting-item">
        <div>
          <div>SSH GPU Host</div>
          <div style="font-size:11px; color:var(--subtle);" id="sshStatusLabel">Not Connected</div>
        </div>
        <button class="send-btn" style="padding:3px 8px; font-size:11px;" id="sshConnectBtn">Connect SSH</button>
      </div>
      <div class="setting-item">
        <span>Configure SSH Profiles</span>
        <button class="send-btn" style="padding:3px 8px; font-size:11px;" id="sshConfigBtn">Add Profile</button>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-title">Safety & Permissions</div>
      <div class="setting-item">
        <span>Auto-approve safe operations</span>
        <input type="checkbox" id="autoApproveCheck" checked>
      </div>
      <div class="setting-item">
        <span>Stale edit protection</span>
        <span style="color:#10b981;">Enabled (SHA-256)</span>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-title">Features</div>
      <div class="setting-item">
        <span>Inline Code Autocomplete</span>
        <input type="checkbox" id="inlineCompCheck" checked>
      </div>
      <div class="setting-item">
        <span>Continue Previous Task</span>
        <button class="send-btn" style="padding:3px 8px; font-size:11px;" id="continueTaskBtn">Continue</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const chatFeed = document.getElementById('chatFeed');
    const promptInput = document.getElementById('promptInput');
    const sendBtn = document.getElementById('sendBtn');
    const modelSelect = document.getElementById('modelSelect');
    const statusDot = document.getElementById('statusDot');
    const remoteBadge = document.getElementById('remoteBadge');
    const activeFilePath = document.getElementById('activeFilePath');
    const settingsDrawer = document.getElementById('settingsDrawer');

    let currentMode = 'agent';
    let isBusy = false;

    // Mode Buttons
    ['agent', 'plan', 'ask'].forEach(mode => {
      document.querySelector('[data-mode="' + mode + '"]').addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-mode="' + mode + '"]').classList.add('active');
        currentMode = mode;
        vscode.postMessage({ type: 'setMode', mode });
      });
    });

    // Action Buttons
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

    modelSelect.addEventListener('change', () => {
      vscode.postMessage({ type: 'selectModel', model: modelSelect.value });
    });

    function sendMessage() {
      const text = promptInput.value.trim();
      if (!text || isBusy) return;
      promptInput.value = '';
      vscode.postMessage({
        type: 'chat',
        model: modelSelect.value,
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
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'models') {
        modelSelect.innerHTML = '';
        msg.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.name;
          opt.textContent = m.displayName || m.name;
          if (m.name === msg.selectedModel) opt.selected = true;
          modelSelect.appendChild(opt);
        });
      }

      if (msg.type === 'activeEditor') {
        activeFilePath.textContent = msg.path ? '· ' + msg.path : '';
      }

      if (msg.type === 'remoteStatus') {
        if (msg.connected) {
          remoteBadge.textContent = '· SSH GPU (' + (msg.profileName || 'Connected') + ')';
          document.getElementById('sshStatusLabel').textContent = 'Connected: ' + (msg.profileName || '');
        } else {
          remoteBadge.textContent = '';
          document.getElementById('sshStatusLabel').textContent = 'Not Connected';
        }
      }

      if (msg.type === 'status') {
        if (msg.state === 'running' || msg.state === 'thinking') {
          isBusy = true;
          statusDot.className = 'status-dot busy';
          sendBtn.textContent = 'Cancel';
        } else {
          isBusy = false;
          statusDot.className = 'status-dot';
          sendBtn.textContent = 'Send';
        }
      }

      if (msg.type === 'activity') {
        const chip = document.createElement('div');
        chip.className = 'activity-chip';
        chip.textContent = msg.text;
        chatFeed.appendChild(chip);
        chatFeed.scrollTop = chatFeed.scrollHeight;
      }

      if (msg.type === 'userMessage') {
        const card = document.createElement('div');
        card.className = 'msg-card';
        card.innerHTML = '<div class="msg-user">' + escapeHtml(msg.content) + '</div>';
        chatFeed.appendChild(card);
        chatFeed.scrollTop = chatFeed.scrollHeight;
      }

      if (msg.type === 'done') {
        const card = document.createElement('div');
        card.className = 'msg-card';
        card.innerHTML = '<div class="msg-assistant">' + escapeHtml(msg.fullResponse).replace(/\\n/g, '<br>') + '</div>';
        chatFeed.appendChild(card);
        chatFeed.scrollTop = chatFeed.scrollHeight;
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
