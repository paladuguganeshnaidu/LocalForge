import * as vscode from 'vscode';
import { ModelRegistry } from '../providers/modelRegistry';
import { ModelRouter, TaskType } from '../providers/modelRouter';
import { ModelProvider, ChatMessage } from '../providers/modelProvider';
import { ConfiguredProviders } from '../providers/configuredProviders';
import { EndpointConfiguration } from '../providers/endpointConfiguration';
import { CompositeProvider } from '../providers/compositeProvider';
import { WorkspaceIndexer } from '../context/workspaceIndexer';
import { ContextEngine } from '../context/contextEngine';
import { GitContextService } from '../context/gitContext';
import { ToolRegistry } from '../agent/toolRegistry';
import { isPermissionMode, PermissionManager } from '../agent/permissionManager';
import { AgentEngine, AgentRunSummary } from '../agent/agentEngine';
import { AgentMode } from '../agent/agentLoop';
import { resolveEffortBudget } from '../agent/effort';
import { EditEngine, EditRollbackResult } from '../editing/editEngine';
import { RemoteManager } from '../remote/remoteManager';
import { SessionManager } from './sessionManager';
import { TaskManager } from './taskManager';
import { DiagnosticsService } from './diagnosticsService';
import { LocalForgeEventEmitter } from './events';
import { registerWorkspaceTools } from '../agent/workspaceTools';
import { ArtifactManager, Artifact } from './artifactManager';
import { TurnManager, AgentTurn, TurnActivity, ExecutionStrategy } from './turnManager';
import { TerminalManager } from '../terminal/terminalManager';
import { BrowserTool, BROWSER_TOOL_DEFINITION } from '../browser/browserTool';
import { ContextReferenceResolver } from '../context/referenceResolver';
import { MultiAgentOrchestrator, OrchestratorOptions, OrchestrationResult } from '../agent/orchestration/orchestrator';
import { CheckpointManager } from '../agent/orchestration/checkpointManager';
import { registerAllCoreTools } from '../agent/coreTools';
import { registerWorkflowTools } from '../agent/workflowTools';
import { registerSubagentTools } from '../agent/subagentTools';
import { ProductMode } from '../agent/orchestration/types';
import { LocalForgeSelfTest } from './selfTest';
import { formatCommandLabel, formatToolInput, formatToolOutput } from './activityDetails';
import { AgentAccessPolicy, AccessScope } from '../agent/accessPolicy';
import { registerExternalTools } from '../agent/externalTools';
import { createRepositorySummaryFormatter, createRepositorySummaryValidator } from '../agent/summaryEvidence';
import { classifyTaskIntent, conversationalMessages, isReadOnlyInspectionTask, requiresWorkspaceToolUse } from '../agent/taskIntent';
import { getEditRequestPolicy } from '../editing/editRequestPolicy';
import { ChatMemoryIndex, readChatMemoryOptions, sanitizeContext } from '../context/chatMemory';
import { composeRequestContext, formatRequestContext, RequestContextSource } from '../context/requestContext';

export interface EngineInitOptions extends EndpointConfiguration {}

export interface ExecuteTaskOptions {
  strategy?: ExecutionStrategy;
  onProgress?: (msg: string) => void;
  onToken?: (token: string) => void;
  onActivity?: (activity: TurnActivity) => void;
  onArtifact?: (artifact: Artifact) => void;
}

export class LocalForgeEngine {
  public readonly events = new LocalForgeEventEmitter();
  public readonly modelRegistry: ModelRegistry;
  public readonly compositeProvider: CompositeProvider;
  public readonly modelRouter: ModelRouter;
  public readonly toolRegistry: ToolRegistry;
  public readonly accessPolicy = new AgentAccessPolicy();
  public readonly permissionManager: PermissionManager;
  public readonly editEngine: EditEngine;
  public readonly agentEngine: AgentEngine;
  public readonly remoteManager: RemoteManager;
  public readonly sessionManager: SessionManager;
  public readonly taskManager: TaskManager;
  public readonly diagnosticsService: DiagnosticsService;
  public readonly gitContextService: GitContextService;
  public readonly artifactManager: ArtifactManager;
  public readonly turnManager: TurnManager;
  public readonly terminalManager: TerminalManager;
  public readonly browserTool: BrowserTool;
  public readonly referenceResolver: ContextReferenceResolver;
  public readonly orchestrator: MultiAgentOrchestrator;
  public readonly checkpointManager: CheckpointManager;
  public readonly selfTest: LocalForgeSelfTest;

  public indexer?: WorkspaceIndexer;
  public contextEngine?: ContextEngine;

  private currentAbortController?: AbortController;
  private traceSaveTimer?: ReturnType<typeof setTimeout>;
  private tracePersistence: Promise<void> = Promise.resolve();
  private readonly configuredProviders: ConfiguredProviders;
  private pendingProviderConfiguration?: EngineInitOptions;
  private providerRefresh?: Promise<void>;
  private providersDisposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: EngineInitOptions = {}
  ) {
    this.modelRegistry = new ModelRegistry();
    this.compositeProvider = new CompositeProvider([], this.modelRegistry);
    const ollamaGenerationOptions = () => {
      const configuration = vscode.workspace.getConfiguration('tuxnest.ollama');
      const effort = this.sessionManager?.getActiveSession().effort ?? 'medium';
      const budget = resolveEffortBudget(effort, { contextWindow: configuration.get<number>('contextWindow', 8192), maxOutputTokens: configuration.get<number>('maxOutputTokens', -1) });
      return {
        num_ctx: budget.contextWindow,
        num_predict: budget.maxOutputTokens,
        temperature: configuration.get<number>('temperature', 0.1),
        thinking: configuration.get<boolean>('agentThinking', false)
      };
    };
    this.configuredProviders = new ConfiguredProviders(this.modelRegistry, ollamaGenerationOptions);

    this.configuredProviders.configure(options);
    context.subscriptions.push({ dispose: () => { for (const provider of this.modelRegistry.getAllProviders()) provider.dispose?.(); } });
    context.subscriptions.push({ dispose: () => { this.providersDisposed = true; this.pendingProviderConfiguration = undefined; } });

    this.modelRouter = new ModelRouter(() => this.modelRegistry.getModels());

    const savedPermissionMode = context.globalState?.get<unknown>('tuxnest.permissionMode') ?? context.globalState?.get<unknown>('localforge.permissionMode');
    this.permissionManager = new PermissionManager(isPermissionMode(savedPermissionMode) ? savedPermissionMode : 'always_ask');
    this.permissionManager.setAccessPolicy(this.accessPolicy);
    this.toolRegistry = new ToolRegistry();
    this.toolRegistry.setAccessPolicy(this.accessPolicy);
    registerExternalTools(this.toolRegistry, async (path) => await vscode.window.showWarningMessage(`Sensitive file: ${path}. Reading it may send credentials to the selected model endpoint. Approve only if you intend to expose this content.`, { modal: true }, 'Read sensitive file') === 'Read sensitive file');

    this.editEngine = new EditEngine(context.workspaceState, context.storageUri?.scheme === 'file' ? context.storageUri.fsPath : undefined);
    this.terminalManager = new TerminalManager();
    this.agentEngine = new AgentEngine(this.toolRegistry, this.permissionManager, this.editEngine, this.terminalManager);
    this.remoteManager = new RemoteManager(context, this.compositeProvider, this.modelRegistry, ollamaGenerationOptions, (reason) => {
      this.events.emit('remoteDisconnected', reason);
      this.events.emit('providersChanged');
    });
    this.sessionManager = new SessionManager(context.workspaceState, context.storageUri?.scheme === 'file' ? context.storageUri.fsPath : undefined);
    this.taskManager = new TaskManager(context.workspaceState);
    this.gitContextService = new GitContextService();

    this.artifactManager = new ArtifactManager();
    this.turnManager = new TurnManager(() => this.scheduleTraceSave());
    this.turnManager.restorePersistedHistory(context.workspaceState.get<unknown>('tuxnest.activityTraceHistory') ?? context.workspaceState.get<unknown>('localforge.activityTraceHistory'));
    this.browserTool = new BrowserTool();
    context.subscriptions.push({ dispose: () => { void this.browserTool.dispose(); } });
    this.referenceResolver = new ContextReferenceResolver(this.gitContextService, this.terminalManager);

    this.orchestrator = new MultiAgentOrchestrator(
      this.compositeProvider,
      this.toolRegistry,
      this.permissionManager,
      this.editEngine
    );
    this.checkpointManager = new CheckpointManager(context.workspaceState);
    this.selfTest = new LocalForgeSelfTest(this);

    this.registerDefaultTools();
    this.initWorkspaceContext();

    this.diagnosticsService = new DiagnosticsService(
      this.modelRegistry,
      this.remoteManager,
      this.indexer,
      this.toolRegistry,
      this.permissionManager
    );
  }

  private registerDefaultTools(): void {
    registerWorkspaceTools(this.toolRegistry, () => ({
      editEngine: this.editEngine,
      terminalManager: this.terminalManager,
      autoApply: this.permissionManager.shouldAutoApplyEdits()
    }));
    registerAllCoreTools(this.toolRegistry, {
      editEngine: this.editEngine,
      terminalManager: this.terminalManager,
      artifactManager: this.artifactManager,
      browserTool: this.browserTool,
      autoApply: () => this.permissionManager.shouldAutoApplyEdits()
    });
    registerWorkflowTools(this.toolRegistry, this.permissionManager);
    registerSubagentTools(this.toolRegistry, this.permissionManager, this.compositeProvider, () => this.sessionManager.getActiveSession().model, message => this.events.emit('subagentProgress', message));
    this.toolRegistry.assertInvariants();
  }

  private initWorkspaceContext(): void {
    const roots = vscode.workspace.workspaceFolders;
    if (roots && roots.length > 0) {
      this.indexer = new WorkspaceIndexer();
      this.contextEngine = new ContextEngine(this.indexer);
      this.context.subscriptions.push(this.indexer, this.indexer.onDidChange((status) => this.events.emit('indexStatus', status)), this.editEngine.onDidChangeFiles((uris) => this.indexer?.notifyFilesChanged(uris)));
      this.indexer.startWatching();
      void this.indexer.indexWorkspace().then((count) => {
        this.events.emit('indexProgress', `Indexed ${count} workspace files`);
      }).catch((error) => this.events.emit('indexProgress', `Workspace index failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  public async bootstrap(): Promise<void> {
    await this.reconcileProviderConfiguration();
    await this.modelRegistry.refresh();
    try {
      if (await this.browserTool.isAvailable() && !this.toolRegistry.hasTool(BROWSER_TOOL_DEFINITION.function.name)) {
        this.toolRegistry.registerTool(BROWSER_TOOL_DEFINITION, (args, execution) => this.browserTool.execute(args as any, execution.signal));
      }
    } catch {}
  }

  public getProviderConfigurationStatus(): { pending: boolean; errors: string[] } {
    return { pending: !!this.pendingProviderConfiguration || !!this.providerRefresh, errors: this.configuredProviders.getErrors() };
  }

  public async updateProviderConfiguration(configuration: EngineInitOptions): Promise<void> {
    if (this.providersDisposed) throw new Error('Provider configuration is disposed.');
    this.pendingProviderConfiguration = { ...configuration };
    this.events.emit('providersChanged');
    await this.reconcileProviderConfiguration();
  }

  private async reconcileProviderConfiguration(): Promise<void> {
    if (this.isBusy() || this.providersDisposed) return;
    if (this.providerRefresh) return this.providerRefresh;
    if (!this.pendingProviderConfiguration) return;
    const refresh = (async () => {
      while (this.pendingProviderConfiguration && !this.isBusy() && !this.providersDisposed) {
        const configuration = this.pendingProviderConfiguration;
        this.pendingProviderConfiguration = undefined;
        this.configuredProviders.configure(configuration);
        this.events.emit('providersChanged');
        await this.modelRegistry.refresh();
      }
    })();
    this.providerRefresh = refresh;
    try { await refresh; }
    finally { if (this.providerRefresh === refresh) this.providerRefresh = undefined; this.events.emit('providersChanged'); }
  }

  public getActivityHistory(conversationId: string): TurnActivity[] {
    const session = this.sessionManager.getSessions().find((session) => session.id === conversationId);
    if (!session) return [];
    return this.turnManager.getTurnsForConversation(conversationId)
      .filter((turn) => turn.historyEpoch === session.historyEpoch)
      .slice(-12)
      .flatMap((turn) => turn.activities.slice(-32));
  }

  public async flushActivityHistory(): Promise<void> {
    if (this.traceSaveTimer) clearTimeout(this.traceSaveTimer);
    this.traceSaveTimer = undefined;
    const saving = (this.tracePersistence ?? Promise.resolve()).then(async () => {
      const sessions = new Map(this.sessionManager.getSessions().map((session) => [session.id, session]));
      const history = this.turnManager.getPersistedHistory().filter((turn) => sessions.has(turn.conversationId) && turn.historyEpoch === sessions.get(turn.conversationId)?.historyEpoch);
      await this.context.workspaceState.update('tuxnest.activityTraceHistory', history);
    });
    this.tracePersistence = saving.catch(() => {});
    await saving;
  }

  public async initializeConversationHistory(): Promise<void> {
    await this.sessionManager.initialize();
    const sessions = new Map(this.sessionManager.getSessions().map((session) => [session.id, session]));
    this.turnManager.restorePersistedHistory(this.turnManager.getPersistedHistory().filter((turn) => sessions.has(turn.conversationId) && turn.historyEpoch === sessions.get(turn.conversationId)?.historyEpoch));
  }

  public async clearConversation(id: string): Promise<void> {
    if (this.isBusy()) throw new Error('Wait for the task or cancel it before clearing chat.');
    await this.clearConversationState(id);
  }

  private async clearConversationState(id: string): Promise<void> {
    await this.sessionManager.clearSession(id);
    this.turnManager.purgeConversation(id);
    this.artifactManager.purgeConversation(id);
    await this.flushActivityHistory();
  }

  public async deleteConversation(id: string): Promise<void> {
    if (this.isBusy()) throw new Error('Wait for the task or cancel it before deleting chat.');
    await this.sessionManager.deleteSession(id);
    this.turnManager.purgeConversation(id);
    this.artifactManager.purgeConversation(id);
    await this.flushActivityHistory();
  }

  private scheduleTraceSave(): void {
    if (this.traceSaveTimer) clearTimeout(this.traceSaveTimer);
    this.traceSaveTimer = setTimeout(() => {
      this.traceSaveTimer = undefined;
      void this.flushActivityHistory().catch((error) => {
        void vscode.window.showErrorMessage(`Could not save chat activity: ${error instanceof Error ? error.message : error}`);
      });
    }, 150);
  }

  public cancelCurrentTask(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = undefined;
    }
  }

  public isBusy(): boolean {
    return Boolean(this.currentAbortController);
  }

  public setAccessScope(scope: AccessScope, filePath?: string): void {
    if (this.isBusy()) throw new Error('Wait for the current task or cancel it before changing access.');
    this.accessPolicy.setScope(scope, filePath);
    this.permissionManager.clearSession();
  }

  public async executeTask(
    userPrompt: string,
    mode: AgentMode,
    modelPreference?: string,
    onProgressOrOptions?: ((msg: string) => void) | ExecuteTaskOptions,
    legacyOnToken?: (token: string) => void
  ): Promise<AgentRunSummary> {
    await this.sessionManager.initialize();
    this.cancelCurrentTask();
    await this.reconcileProviderConfiguration();
    const controller = new AbortController();
    this.currentAbortController = controller;
    try {
      return await this.executeTaskRun(controller.signal, userPrompt, mode, modelPreference, onProgressOrOptions, legacyOnToken);
    } finally {
      if (this.currentAbortController === controller) this.currentAbortController = undefined;
      await this.reconcileProviderConfiguration();
    }
  }

  private async executeTaskRun(
    signal: AbortSignal,
    userPrompt: string,
    mode: AgentMode,
    modelPreference?: string,
    onProgressOrOptions?: ((msg: string) => void) | ExecuteTaskOptions,
    legacyOnToken?: (token: string) => void
  ): Promise<AgentRunSummary> {

    // Normalizing options
    const options: ExecuteTaskOptions =
      typeof onProgressOrOptions === 'function'
        ? { onProgress: onProgressOrOptions, onToken: legacyOnToken }
        : onProgressOrOptions || {};

    const onProgress = options.onProgress;
    const onToken = options.onToken;
    const onActivity = options.onActivity;
    const onArtifact = options.onArtifact;
    let effectiveMode = mode;
    let strategy: ExecutionStrategy = options.strategy || (effectiveMode === 'plan' ? 'planning' : 'fast');

    // 1. Slash commands parsing
    const parsedSlash = this.referenceResolver.parseSlashCommand(userPrompt);
    if (this.accessPolicy.getState().scope === 'file' && parsedSlash.command && !['clear', 'plan', 'context'].includes(parsedSlash.command)) throw new Error('This shortcut is unavailable with File access. Change scope before accessing other project data or running commands.');
    let effectivePrompt = parsedSlash.cleanPrompt || userPrompt;

    if (parsedSlash.command) {
      switch (parsedSlash.command) {
        case 'context': {
          const session = this.sessionManager.getActiveSession();
          const fileScoped = this.accessPolicy.getState().scope === 'file';
          return {
            runId: `run-${Date.now()}`, task: 'Inspect model context', mode: effectiveMode,
            response: fileScoped ? 'File access is active. Prior chat/workspace context is hidden; subsequent requests exclude chat memory and automatic workspace retrieval.' : sanitizeContext(session.lastContextPreview || 'No model request has been sent in this chat yet.'),
            filesModified: [], validationAttempts: [], status: 'completed', durationMs: 0
          };
        }
        case 'search': {
          if (!/^chat(?:\s|$)/i.test(parsedSlash.cleanPrompt)) {
            const query = parsedSlash.cleanPrompt.trim();
            const matches = query && this.indexer ? await this.indexer.search(query, { maxFiles: 8, maxChars: 10000 }) : [];
            signal.throwIfAborted();
            return {
              runId: `run-${Date.now()}`, task: 'Search workspace', mode: effectiveMode,
              response: !query ? 'Usage: `/search <query>` or `/search chat <query>`' : !this.indexer ? 'Open a trusted project workspace to search its index.' : '# Workspace search\n\n' + (matches.length ? matches.map((match) => `## ${match.path}:${match.startLine}–${match.endLine}\nScore: ${match.score.toFixed(3)} · chunk: ${match.chunkId} · SHA-256: ${match.fileHash}${match.truncated ? ' · excerpt truncated' : ''}\n\n${match.text}`).join('\n\n') : 'No matching indexed workspace chunks.') + (this.indexer.getStats().limitReached ? '\n\nIndex limits were reached; these results do not cover every workspace file. Adjust workspace index limits or refine ignore rules.' : ''),
              filesModified: [], validationAttempts: [], status: 'completed', durationMs: 0
            };
          }
          const query = parsedSlash.cleanPrompt.replace(/^chat\b/i, '').trim();
          const session = this.sessionManager.getActiveSession();
          const configuration = vscode.workspace.getConfiguration('tuxnest.chatMemory');
          const memoryOptions = readChatMemoryOptions((key, fallback) => configuration.get(key, fallback));
          const matches = query ? await new ChatMemoryIndex(this.sessionManager).search(query, session.id, { scope: memoryOptions.scope, limit: memoryOptions.resultCount, maximumCharacters: memoryOptions.memoryCharacters, signal }) : [];
          return {
            runId: `run-${Date.now()}`, task: 'Search chat memory', mode: effectiveMode,
            response: !query ? 'Usage: `/search chat <query>`' : `# Chat search (${memoryOptions.scope === 'all' ? 'all chats — explicitly enabled' : 'current chat'})\n\n` + (matches.length ? matches.map((match) => `- Chat ${match.chatId} · message ${match.messageId} · chars ${match.startCharacter}–${match.endCharacter} · score ${match.score.toFixed(3)}\n${match.text}`).join('\n\n') : 'No matching chat memories.'),
            filesModified: [], validationAttempts: [], status: 'completed', durationMs: 0
          };
        }
        case 'clear': {
          const session = this.sessionManager.getActiveSession();
          await this.clearConversationState(session.id);
          return {
            runId: `run-${Date.now()}`,
            task: 'Clear session',
            mode: effectiveMode,
            response: 'Conversation cleared.',
            filesModified: [],
            validationAttempts: [],
            status: 'completed',
            durationMs: 0
          };
        }
        case 'plan': {
          effectiveMode = 'plan';
          strategy = 'planning';
          break;
        }
        case 'diagnose': {
          void vscode.commands.executeCommand('tuxnest.diagnose');
          return {
            runId: `run-${Date.now()}`,
            task: 'Diagnose installation',
            mode: effectiveMode,
            response: 'Diagnostics report opened in output channel.',
            filesModified: [],
            validationAttempts: [],
            status: 'completed',
            durationMs: 0
          };
        }
        case 'remote': {
          void vscode.commands.executeCommand('tuxnest.connectRemote');
          return {
            runId: `run-${Date.now()}`,
            task: 'Remote GPU Connection',
            mode: effectiveMode,
            response: 'Connecting to Remote GPU SSH tunnel...',
            filesModified: [],
            validationAttempts: [],
            status: 'completed',
            durationMs: 0
          };
        }
        case 'terminal': {
          if (effectivePrompt) {
            if (!vscode.workspace.isTrusted) {
              return {
                runId: `run-${Date.now()}`,
                task: `Run terminal command: ${effectivePrompt}`,
                mode: effectiveMode,
                response: 'Terminal execution is blocked: workspace is not trusted.',
                filesModified: [],
                validationAttempts: [],
                status: 'failed',
                durationMs: 0
              };
            }

            try {
              this.permissionManager.validateCommandSafety(effectivePrompt);
            } catch (err: any) {
              return {
                runId: `run-${Date.now()}`,
                task: `Run terminal command: ${effectivePrompt}`,
                mode: effectiveMode,
                response: `Command blocked by safety policy: ${err.message}`,
                filesModified: [],
                validationAttempts: [],
                status: 'failed',
                durationMs: 0
              };
            }

            const allowed = await this.permissionManager.checkPermission('run_command', { command: effectivePrompt }, false, signal);
            if (!allowed) {
              return {
                runId: `run-${Date.now()}`,
                task: `Run terminal command: ${effectivePrompt}`,
                mode: effectiveMode,
                response: `Permission denied for command: \`${effectivePrompt}\`.`,
                filesModified: [],
                validationAttempts: [],
                status: 'failed',
                durationMs: 0
              };
            }

            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (rootPath) {
              const proc = await this.terminalManager.runCommand(effectivePrompt, rootPath);
              return {
                runId: `run-${Date.now()}`,
                task: `Run terminal command: ${effectivePrompt}`,
                mode: effectiveMode,
                response: `Command: \`${proc.command}\`\nExit Code: ${proc.exitCode}\n\n\`\`\`\n${proc.stdout || proc.stderr || '(no output)'}\n\`\`\``,
                filesModified: [],
                validationAttempts: [],
                status: proc.exitCode === 0 ? 'completed' : 'failed',
                durationMs: (proc.endTime || Date.now()) - proc.startTime
              };
            }
          }
          break;
        }
        case 'model': {
          const models = this.modelRegistry.getModels();
          const active = this.modelRouter.route(effectiveMode === 'agent' ? 'agent' : 'chat', modelPreference);
          const list = models.map((m) => `- **${m.displayName || m.name}** (${m.providerId}, ${m.source})`).join('\n');
          return {
            runId: `run-${Date.now()}`,
            task: 'Model status',
            mode: effectiveMode,
            response: `Active Model: **${active.model?.displayName || active.modelId}**\nReason: ${active.reason}\n\nAvailable Models (${models.length}):\n${list}`,
            filesModified: [],
            validationAttempts: [],
            status: 'completed',
            durationMs: 0
          };
        }
        case 'diff': {
          const proposals = this.editEngine.getPendingProposals();
          if (!proposals.length) {
            return {
              runId: `run-${Date.now()}`,
              task: 'Review diff',
              mode: effectiveMode,
              response: 'No pending file changes to review.',
              filesModified: [],
              validationAttempts: [],
              status: 'completed',
              durationMs: 0
            };
          }
          const latest = proposals[0];
          const filesSummary = latest.files.map((f: { path: string; additions: number; deletions: number }) => `- ${f.path} (+${f.additions} -${f.deletions})`).join('\n');
          return {
            runId: `run-${Date.now()}`,
            task: 'Review diff',
            mode: effectiveMode,
            response: `Pending Proposal: ${latest.summary}\nFiles (${latest.files.length}):\n${filesSummary}`,
            filesModified: latest.files.map((f: { path: string }) => f.path),
            validationAttempts: [],
            status: 'completed',
            durationMs: 0
          };
        }
      }
    }

    if (this.modelRegistry.getModels().length === 0) {
      try {
        await this.modelRegistry.discoverAll();
      } catch {}
    }

    const taskType: TaskType = effectiveMode === 'agent' ? 'agent' : 'chat';
    const routing = this.modelRouter.route(taskType, modelPreference);
    let chosenModel = routing.modelId;

    if (!chosenModel) {
      const models = this.modelRegistry.getModels();
      if (models.length > 0) {
        chosenModel = models[0].id || models[0].name;
      } else {
        throw new Error('No local LLM detected. Please ensure Ollama is running (`ollama serve`) or configure a remote GPU / OpenAI-compatible endpoint in TuxNest settings.');
      }
    }

    const agentConfiguration = vscode.workspace.getConfiguration('tuxnest.agent');
    const chosenMetadata = this.modelRegistry.getModels().find((entry) => entry.id === chosenModel || entry.name === chosenModel);
    if (modelPreference && modelPreference.toLowerCase() !== 'auto' && (!routing.model || !chosenMetadata)) throw new Error(`Selected model "${modelPreference}" is unavailable or ambiguous. Your chat is preserved; choose a provider-qualified model.`);
    const ollamaModel = chosenMetadata?.providerId === 'ollama' || chosenMetadata?.providerId.startsWith('ssh-ollama-') || chosenModel.startsWith('ollama:');
    const configuredContextWindow = ollamaModel
      ? Math.min(vscode.workspace.getConfiguration('tuxnest.ollama').get<number>('contextWindow', 8192), chosenMetadata?.capabilities?.contextWindow ?? Infinity)
      : chosenMetadata?.capabilities?.contextWindow ?? 8192;

    const session = this.sessionManager.getActiveSession();
    const effortBudget = resolveEffortBudget(session.effort ?? 'medium', { contextWindow: configuredContextWindow, maxRounds: agentConfiguration.get<number>('maxRounds', 80), historyCharacters: agentConfiguration.get<number>('historyCharacters', 48000) });
    const contextWindow = effortBudget.contextWindow;
    const taskIntent = classifyTaskIntent(effectivePrompt);
    const conversational = taskIntent === 'conversation';
    session.mode = effectiveMode;
    session.model = chosenModel;

    // Start turn
    const turn = this.turnManager.startTurn({
      conversationId: session.id,
      historyEpoch: session.historyEpoch,
      modelId: chosenModel,
      mode: effectiveMode,
      strategy
    });

    const activeActivities = new Map<string, TurnActivity>();

    const emitActivity = (
      category: any,
      title: string,
      status: any = 'running',
      details?: string,
      targetPath?: string,
      id?: string
    ) => {
      const act = this.turnManager.addActivity(turn.turnId, {
        id,
        category,
        title,
        details,
        targetPath,
        status
      });
      onActivity?.(act);
      onProgress?.(title);
      return act;
    };

    const taskRecord = await this.taskManager.recordTaskStart(effectivePrompt, effectiveMode, chosenModel);
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const fileScoped = this.accessPolicy.getState().scope === 'file';
      const resolved = fileScoped || conversational ? { cleanedPrompt: effectivePrompt, references: [] } : await this.referenceResolver.resolveReferences(effectivePrompt, workspaceRoot);
      effectivePrompt = resolved.cleanedPrompt;
      const sources: RequestContextSource[] = resolved.references.map((reference) => ({ category: 'references', label: reference.label, content: reference.content }));
      if (this.contextEngine && !fileScoped && !conversational) {
        const maxTokens = Math.min(agentConfiguration.get<number>('contextTokens', 4000), Math.max(500, Math.floor(contextWindow / 4)));
        const ctx = await this.contextEngine.assembleContext(effectivePrompt, { maxTokens, includeWorkspace: true });
        if (ctx.workspaceSummary) sources.push({ category: 'workspace_summary', label: 'Workspace metadata', content: ctx.workspaceSummary });
        for (const item of ctx.items) sources.push({ category: item.source === 'retrieval' ? 'workspace_retrieval' : item.source, label: item.label, path: item.path, content: item.content, chunk: item.chunk });
      }
      const memoryConfiguration = vscode.workspace.getConfiguration('tuxnest.chatMemory');
      const composed = conversational ? undefined : await composeRequestContext({
        session, prompt: effectivePrompt, policyPrompt: this.accessPolicy.getPrompt(), accessScope: fileScoped ? 'file' : this.accessPolicy.getState().scope,
        contextWindow, memory: new ChatMemoryIndex(this.sessionManager), options: readChatMemoryOptions((key, fallback) => memoryConfiguration.get(key, fallback)), sources, signal
      });
      const messages: ChatMessage[] = conversational ? conversationalMessages(effectivePrompt) : composed!.messages;
      if (composed) session.lastContextPreview = formatRequestContext(composed.report);
      signal.throwIfAborted();
      const result = conversational ? await this.streamConversation(chosenModel, messages, effectivePrompt, effectiveMode, signal, onToken, onProgress) : await this.agentEngine.runTask(
        this.compositeProvider,
        chosenModel,
        messages,
        {
          mode: effectiveMode,
          strategy,
          signal,
          editRequestPolicy: { ...getEditRequestPolicy(userPrompt), conversationId: session.id, turnId: turn.turnId },
          taskPrompt: effectivePrompt,
          maxRounds: effortBudget.maxRounds,
          maxToolDefinitions: ollamaModel ? 16 : undefined,
          readOnlyInspection: isReadOnlyInspectionTask(effectivePrompt),
          maxHistoryCharacters: effortBudget.historyCharacters,
          requireToolUse: effectiveMode !== 'plan' && requiresWorkspaceToolUse(effectivePrompt),
          validateFinalResponse: effectiveMode === 'plan' || taskIntent === 'memory' ? undefined : createRepositorySummaryValidator(effectivePrompt),
          formatFinalResponse: effectiveMode === 'plan' || taskIntent === 'memory' ? undefined : createRepositorySummaryFormatter(effectivePrompt),
          onProgress: (p) => {
            onProgress?.(p);
          },
          onModelText: (text) => onToken?.(text),
          onModelOutput: (text, round, toolNames) => {
            if (!text.trim()) return;
            const actionLabel = toolNames.length ? ` · ${toolNames.join(', ')}` : '';
            emitActivity('Working', 'Agent update', 'success', text.slice(0, 3000));
          },
          onToolStart: (name, args, callId, verificationReason) => {
            let cat: any = this.toolRegistry.getTool(name)?.descriptor.activity ?? 'Working';
            let title = `Running tool ${name}`;
            let targetPath: string | undefined;

            if (name === 'update_plan') {
              cat = 'Planning';
              title = 'Updating the task-specific plan';
            } else if (['search_workspace', 'search_text', 'search_files', 'symbol_search'].includes(name)) {
              cat = 'Searching';
              title = `Searching workspace for "${(args as any).query || ''}"`;
            } else if (['read_workspace_file', 'read_file', 'read_files'].includes(name)) {
              cat = 'Reading';
              targetPath = (args as any).path;
              title = `Reading ${targetPath || 'file'}`;
            } else if (name === 'read_machine_file') {
              cat = 'Reading';
              targetPath = String(args.path ?? '');
              title = `Reading outside workspace: ${targetPath}`;
            } else if (name === 'list_directory' || name === 'list_machine_directory') {
              cat = 'Reading';
              targetPath = String(args.path ?? args.directory ?? '');
              title = `Reading directory: ${targetPath || 'workspace root'}`;
            } else if (name === 'read_web_page') {
              cat = 'Searching';
              title = `Reading internet documentation: ${String(args.url ?? '')}`;
            } else if (['write_workspace_file', 'edit_workspace_file', 'write_file', 'create_file', 'replace_range', 'delete_file', 'move_file'].includes(name)) {
              cat = 'Editing';
              targetPath = String(args.path ?? args.source_path ?? '');
              title = name === 'delete_file' ? `Preparing deletion of ${targetPath}` : name === 'move_file'
                ? `Preparing move: ${targetPath} → ${String(args.destination_path ?? '')}` : `Preparing edit for ${targetPath || 'file'}`;
            } else if (['run_command', 'run_test', 'run_build', 'run_lint', 'install_dependencies', 'install_packages', 'start_dev_server'].includes(name)) {
              cat = 'Running';
              title = `Running: ${formatCommandLabel(name, args)}`;
            } else if (name === 'browser_action') {
              cat = 'Browser';
              title = `Browser action: ${(args as any).action || ''}`;
            }

            const act = this.turnManager.addActivity(turn.turnId, {
              id: callId,
              category: cat,
              title: verificationReason ? `${title} · automatic verification` : title,
              status: 'running',
              targetPath,
              toolName: name,
              inputSummary: verificationReason ? `Agent-scheduled verification: ${verificationReason}\n${formatToolInput(name, args)}` : formatToolInput(name, args)
            });
            onActivity?.(act);
            onProgress?.(title);
            activeActivities.set(callId, act);
          },
          onToolEnd: (name, res, error, callId) => {
            const existing = callId ? activeActivities.get(callId) : undefined;
            if (existing) {
              const commandResult = res && typeof res === 'object' ? res as Record<string, unknown> : {};
              const settledTitle = signal.aborted ? `Cancelled: ${existing.title}` : error ? `Failed: ${existing.title}` :
                commandResult.duplicateSuppressed ? `Reused previous result: ${existing.title}` : name === 'start_dev_server' && commandResult.status === 'running' ? `${commandResult.reused === true ? 'Using running process' : 'Started process'}: ${formatCommandLabel(name, commandResult)} · check readiness` : name === 'update_plan' ? 'Task plan updated (model-reported)' : commandResult.applied === true && existing.targetPath ? `${commandResult.operation === 'create' ? 'Created' : 'Saved'} ${existing.targetPath}` : existing.title.startsWith('Running:')
                  ? `Ran: ${typeof commandResult.command === 'string' ? formatCommandLabel(name, commandResult) : existing.title.slice(8).trim()}` + (typeof commandResult.exitCode === 'number' ? ` · exit ${commandResult.exitCode}` : '')
                  : existing.title.replace(/^Reading\b/, 'Read').replace(/^Preparing\b/, 'Prepared').replace(/^Searching\b/, 'Searched');
              const updated = this.turnManager.updateActivity(turn.turnId, existing.id, {
                title: settledTitle,
                status: signal.aborted ? 'cancelled' : error ? 'error' : 'success',
                durationMs: Date.now() - existing.timestamp,
                error: error || undefined,
                outputSummary: formatToolOutput(res, error),
                resultSummary: res ? (typeof res === 'object' ? JSON.stringify(res).slice(0, 150) : String(res).slice(0, 150)) : undefined
              });
              if (updated) onActivity?.(updated);
            }
          }
        },
        workspaceRoot
      );

      // Handle Plan Mode artifact creation
      if (effectiveMode === 'plan' && !conversational) {
        const planArtifact = this.artifactManager.createArtifact({
          type: 'Implementation Plan',
          title: `Implementation Plan: ${effectivePrompt.slice(0, 50)}`,
          content: result.response,
          conversationId: session.id,
          turnId: turn.turnId,
          relatedFiles: result.filesModified
        });
        this.turnManager.addArtifact(turn.turnId, planArtifact);
        onArtifact?.(planArtifact);
        emitActivity('Planning', 'Implementation Plan prepared for review', 'waiting_for_approval');
      }

      // Check if edits are pending review
      const pending = conversational ? [] : this.editEngine.getPendingProposals();
      // Handle Walkthrough artifact creation if files were already modified (e.g. In auto-apply mode)
      if (effectiveMode === 'agent' && result.filesModified.length > 0) {
        const walkthrough = this.artifactManager.createWalkthrough({
          summary: `Completed changes for: ${effectivePrompt.slice(0, 80)}`,
          filesChanged: result.filesModified,
          behaviorChanges: 'Applied the file changes recorded in this run.',
          testsRun: result.validationAttempts.length ? `${result.validationAttempts.length} test run(s)` : 'None configured',
          validationResult: result.validationAttempts.length === 0 ? 'No automated validation was run' : result.validationAttempts.every((v) => v.result.passed) ? 'All validation checks passed' : 'Validation check failed',
          verificationSteps: 'Inspect changes in diff view and verify project operation.',
          conversationId: session.id,
          turnId: turn.turnId
        });
        this.turnManager.addArtifact(turn.turnId, walkthrough);
        onArtifact?.(walkthrough);
      }

      const awaitingReview = !conversational && (pending.length > 0 || effectiveMode === 'plan');
      const resultErrors = result.errors ?? [];
      const hasToolWarnings = resultErrors.length > 0;
      this.turnManager.completeTurn(turn.turnId, result.status === 'cancelled' ? 'cancelled' : result.status === 'failed' ? 'failed' : awaitingReview ? 'waiting_for_approval' : 'completed', result.filesModified);
      if (awaitingReview && !['cancelled', 'failed'].includes(result.status)) {
        emitActivity('Waiting for approval', effectiveMode === 'plan' && pending.length === 0 ? 'Plan ready for review' : `Changes ready for review (${pending[0]?.files.length ?? 0} file(s))`, 'waiting_for_approval', resultErrors.length ? resultErrors.join('\n') : undefined);
      } else if (result.status === 'failed') {
        emitActivity('Failed', 'Task did not complete', 'error', resultErrors.join('\n') || result.response);
      } else if (result.status === 'cancelled') {
        emitActivity('Cancelled', 'Task cancelled', 'cancelled');
      } else if (hasToolWarnings) {
        emitActivity('Completed', 'Completed with tool warnings', 'warning', resultErrors.join('\n'));
      } else {
        emitActivity('Completed', 'Task completed', 'success');
      }

      await this.sessionManager.appendMessages(session.id, [
        { role: 'user', content: userPrompt, turnId: turn.turnId },
        { role: 'assistant', content: result.response, model: chosenModel, providerId: chosenMetadata?.providerId, turnId: turn.turnId, memorySources: composed?.report.memorySources }
      ], { mode: effectiveMode, strategy, model: chosenModel, filesModified: result.filesModified, lastContextPreview: conversational ? 'Conversational response: current message only; no project, references, tools, or prior messages.' : session.lastContextPreview }, { epoch: session.historyEpoch });

      await this.taskManager.recordTaskCompletion(
        taskRecord.id,
        result.status === 'failed' || result.status === 'cancelled' ? result.status : awaitingReview ? 'waiting_for_approval' : result.status,
        result.filesModified,
        result.response.slice(0, 500)
      );

      await this.flushActivityHistory();
      return result;
    } catch (err: any) {
      this.turnManager.completeTurn(turn.turnId, signal.aborted ? 'cancelled' : 'failed');
      const errDetail = err?.message || (signal.aborted ? 'Task cancelled' : 'Task execution failed');
      emitActivity(
        signal.aborted ? 'Cancelled' : 'Failed',
        signal.aborted ? 'Task cancelled' : (err?.message ? `Failed: ${err.message}` : 'Task execution failed'),
        signal.aborted ? 'cancelled' : 'error',
        errDetail
      );
      await this.taskManager.recordTaskCompletion(taskRecord.id, signal.aborted ? 'cancelled' : 'failed', [], errDetail.slice(0, 500));
      await this.flushActivityHistory();
      throw err;
    }
  }

  private async streamConversation(
    model: string,
    messages: ChatMessage[],
    task: string,
    mode: AgentMode,
    signal: AbortSignal,
    onToken?: (token: string) => void,
    onProgress?: (message: string) => void
  ): Promise<AgentRunSummary> {
    const startedAt = Date.now();
    let response = '';
    signal.throwIfAborted();
    onProgress?.('Thinking');
    await this.compositeProvider.streamChat(model, messages, (token) => {
      if (signal.aborted) return;
      response += token;
      onToken?.(token);
    }, signal);
    signal.throwIfAborted();
    if (!response.trim()) throw new Error('The selected model returned an empty response. Try again or select another model.');
    return { runId: `run-${startedAt}`, task, mode, response, status: 'completed', filesModified: [], validationAttempts: [], errors: [], durationMs: Date.now() - startedAt };
  }

  public async applyProposalAndValidate(
    proposalId: string,
    files?: string[],
    onActivity?: (act: TurnActivity) => void,
    onProgress?: (msg: string) => void,
    onArtifact?: (art: Artifact) => void
  ): Promise<any> {
    if (this.isBusy()) throw new Error('A task is already running. Wait or cancel it before applying a proposal.');
    const controller = new AbortController();
    this.currentAbortController = controller;
    try {
      return await this.applyProposalRun(controller.signal, proposalId, files, onActivity, onProgress, onArtifact);
    } finally {
      if (this.currentAbortController === controller) this.currentAbortController = undefined;
      await this.reconcileProviderConfiguration();
    }
  }

  private async applyProposalRun(
    signal: AbortSignal,
    proposalId: string,
    files?: string[],
    onActivity?: (act: TurnActivity) => void,
    onProgress?: (msg: string) => void,
    onArtifact?: (art: Artifact) => void
  ): Promise<any> {
    const session = this.sessionManager.getActiveSession();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const turn = this.turnManager.startTurn({
      conversationId: session.id,
      historyEpoch: session.historyEpoch,
      modelId: session.model || '',
      mode: 'agent',
      strategy: 'fast'
    });

    const emitAct = (cat: any, title: string, status: any = 'running', details?: string) => {
      const act = this.turnManager.addActivity(turn.turnId, {
        category: cat,
        title,
        status,
        details
      });
      onActivity?.(act);
      onProgress?.(`${cat}: ${title}`);
      return act;
    };

    try {
      const proposal = this.editEngine.getProposal(proposalId);
      if (proposal) for (const file of proposal.files.filter((file) => !files || files.includes(file.path))) this.accessPolicy.assertFile(file.path);
      const editResult = await this.editEngine.applyProposal(proposalId, files, signal);
      if (!editResult.success) {
        emitAct('Editing', 'Failed to apply proposal changes', 'error', editResult.errors.map((error) => error.error).join(', '));
        this.turnManager.completeTurn(turn.turnId, 'failed');
        return editResult;
      }

      emitAct('Editing', `Applied changes to ${editResult.appliedCount} file(s)`, 'success');

      let validationPassed: boolean | undefined;
      if (workspaceRoot && editResult.appliedFiles.length > 0 && this.accessPolicy.getState().scope !== 'file') {
        emitAct('Validating', 'Running project validation tests...', 'running');
        const attempts = await this.agentEngine.validateAndRepair(
          this.compositeProvider,
          session.model || '',
          session.messages,
          'Applied proposed edits.',
          editResult.appliedFiles,
          workspaceRoot,
          {
            signal,
            onProgress: (progress) => {
              onProgress?.(progress);
              if (progress.includes('Repair')) {
                emitAct('Repairing', progress, 'running');
              }
            }
          }
        );

        validationPassed = attempts.length ? attempts.at(-1)!.result.passed : undefined;
        emitAct('Validating', validationPassed === true ? 'Validation passed' : validationPassed === false ? 'Validation failed' : 'No automated validation was run', validationPassed === true ? 'success' : validationPassed === false ? 'error' : 'warning');

        const walkthrough = this.artifactManager.createWalkthrough({
          summary: `Applied ${editResult.appliedFiles.length} file(s)`,
          filesChanged: editResult.appliedFiles,
          behaviorChanges: 'Applied the selected proposed changes.',
          testsRun: attempts.length ? `${attempts.length} test run(s)` : 'No automated validation was run',
          validationResult: validationPassed === true ? 'The final validation command passed' : validationPassed === false ? 'Validation check failed' : 'Not verified automatically',
          verificationSteps: 'Inspect modified files and run test suite.',
          conversationId: session.id,
          turnId: turn.turnId
        });
        this.turnManager.addArtifact(turn.turnId, walkthrough);
        onArtifact?.(walkthrough);
      }
      if (this.accessPolicy.getState().scope === 'file') emitAct('Validating', 'Automatic project commands are disabled with File access. Change scope to run tests.', 'warning');

      this.turnManager.completeTurn(turn.turnId, validationPassed === false ? 'failed' : 'completed', editResult.appliedFiles);
      emitAct(
        validationPassed === false ? 'Failed' : 'Completed',
        validationPassed === false ? 'Changes applied; validation needs attention' : validationPassed === true ? 'Changes applied and verified' : 'Changes applied',
        validationPassed === false ? 'error' : 'success'
      );

      session.filesModified = Array.from(new Set([...session.filesModified, ...editResult.appliedFiles]));
      await this.sessionManager.updateSession(session.id, { filesModified: session.filesModified });
      return { ...editResult, validationPassed };
    } catch (error) {
      this.turnManager.completeTurn(turn.turnId, signal.aborted ? 'cancelled' : 'failed');
      emitAct(signal.aborted ? 'Cancelled' : 'Failed', signal.aborted ? 'Review validation cancelled; inspect any already applied changes' : 'Review application or validation failed', signal.aborted ? 'cancelled' : 'error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  public async rollbackRecordedChanges(recoveryId: string, files?: string[], onActivity?: (activity: TurnActivity) => void): Promise<EditRollbackResult> {
    if (this.isBusy()) throw new Error('Wait for the current task or cancel it before restoring changes.');
    if (this.accessPolicy.getState().scope === 'file') throw new Error('Recorded project rollback requires Project workspace access.');
    const controller = new AbortController();
    const session = this.sessionManager.getActiveSession();
    const turn = this.turnManager.startTurn({ conversationId: session.id, historyEpoch: session.historyEpoch, modelId: session.model || '', mode: 'agent', strategy: 'fast' });
    const activity = this.turnManager.addActivity(turn.turnId, {
      category: 'Editing', title: 'Restoring recorded changes', status: 'running', toolName: 'rollback_changes', inputSummary: recoveryId
    });
    this.currentAbortController = controller;
    try {
      onActivity?.(activity);
      const result = await this.editEngine.rollbackChanges(recoveryId, files, controller.signal);
      const updated = this.turnManager.updateActivity(turn.turnId, activity.id, {
        status: result.success ? 'success' : 'error',
        title: result.success ? `Restored ${result.restoredFiles.length} file(s)` : 'Rollback refused or incomplete',
        outputSummary: JSON.stringify(result), durationMs: Date.now() - activity.timestamp
      });
      if (updated) onActivity?.(updated);
      this.turnManager.completeTurn(turn.turnId, result.success ? 'completed' : 'failed', result.restoredFiles);
      return result;
    } catch (error) {
      const updated = this.turnManager.updateActivity(turn.turnId, activity.id, {
        status: controller.signal.aborted ? 'cancelled' : 'error',
        error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - activity.timestamp
      });
      if (updated) onActivity?.(updated);
      this.turnManager.completeTurn(turn.turnId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw error;
    } finally {
      if (this.currentAbortController === controller) this.currentAbortController = undefined;
    }
  }

  public async executeMultiAgentTask(
    userGoal: string,
    mode: ProductMode = 'agent',
    modelPreference?: string,
    options: OrchestratorOptions = {}
  ): Promise<OrchestrationResult> {
    if (this.isBusy()) throw new Error('A task is already running. Wait or cancel it before starting another task.');
    if (this.accessPolicy.getState().scope === 'file') throw new Error('Multi-agent project execution is unavailable with File access.');
    const routing = this.modelRouter.route(mode === 'agent' ? 'agent' : 'chat', modelPreference);
    const chosenModel = routing.modelId;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      throw new Error('Open a workspace folder before executing multi-agent tasks.');
    }
    const controller = new AbortController();
    const cancelFromParent = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancelFromParent();
    else options.signal?.addEventListener('abort', cancelFromParent, { once: true });
    this.currentAbortController = controller;
    try {
      return await this.orchestrator.executeGoal(userGoal, chosenModel, workspaceRoot, { ...options, signal: controller.signal, mode });
    } finally {
      options.signal?.removeEventListener('abort', cancelFromParent);
      if (this.currentAbortController === controller) this.currentAbortController = undefined;
      await this.reconcileProviderConfiguration();
    }
  }
}
