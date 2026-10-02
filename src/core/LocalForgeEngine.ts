import * as vscode from 'vscode';
import { ModelRegistry } from '../providers/modelRegistry';
import { ModelRouter, TaskType } from '../providers/modelRouter';
import { ModelProvider, ChatMessage } from '../providers/modelProvider';
import { OllamaProvider } from '../providers/ollamaProvider';
import { OpenAiCompatibleProvider } from '../providers/openAiCompatibleProvider';
import { CompositeProvider } from '../providers/compositeProvider';
import { WorkspaceIndexer } from '../context/workspaceIndexer';
import { ContextEngine } from '../context/contextEngine';
import { GitContextService } from '../context/gitContext';
import { ToolRegistry } from '../agent/toolRegistry';
import { isPermissionMode, PermissionManager } from '../agent/permissionManager';
import { AgentEngine, AgentRunSummary } from '../agent/agentEngine';
import { AgentMode } from '../agent/agentLoop';
import { EditEngine, EditRollbackResult } from '../editing/editEngine';
import { RemoteManager } from '../remote/remoteManager';
import { SessionManager } from './sessionManager';
import { TaskManager } from './taskManager';
import { DiagnosticsService } from './diagnosticsService';
import { LocalForgeEventEmitter } from './events';
import { allWorkspaceTools, executeWorkspaceTool } from '../agent/workspaceTools';
import { ArtifactManager, Artifact } from './artifactManager';
import { TurnManager, AgentTurn, TurnActivity, ExecutionStrategy } from './turnManager';
import { TerminalManager } from '../terminal/terminalManager';
import { BrowserTool, BROWSER_TOOL_DEFINITION } from '../browser/browserTool';
import { ContextReferenceResolver } from '../context/referenceResolver';
import { MultiAgentOrchestrator, OrchestratorOptions, OrchestrationResult } from '../agent/orchestration/orchestrator';
import { CheckpointManager } from '../agent/orchestration/checkpointManager';
import { registerAllCoreTools } from '../agent/coreTools';
import { ProductMode } from '../agent/orchestration/types';
import { LocalForgeSelfTest } from './selfTest';
import { formatToolInput, formatToolOutput } from './activityDetails';

export interface EngineInitOptions {
  ollamaEndpoint?: string;
  openAiEndpoint?: string;
}

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

  constructor(
    private readonly context: vscode.ExtensionContext,
    options: EngineInitOptions = {}
  ) {
    const ollamaUrl = options.ollamaEndpoint || 'http://127.0.0.1:11434';
    const localOllama = new OllamaProvider(ollamaUrl, 'ollama');

    const defaultProviders: ModelProvider[] = [localOllama];
    if (options.openAiEndpoint) {
      defaultProviders.push(new OpenAiCompatibleProvider('openai', options.openAiEndpoint));
    }

    this.compositeProvider = new CompositeProvider(defaultProviders);
    this.modelRegistry = new ModelRegistry();
    this.modelRegistry.registerProvider(localOllama, localOllama.source, ollamaUrl);
    if (options.openAiEndpoint) {
      this.modelRegistry.registerProvider(new OpenAiCompatibleProvider('openai', options.openAiEndpoint), 'local', options.openAiEndpoint);
    }

    this.modelRouter = new ModelRouter(() => this.modelRegistry.getModels());

    const savedPermissionMode = context.globalState?.get<unknown>('localforge.permissionMode');
    this.permissionManager = new PermissionManager(isPermissionMode(savedPermissionMode) ? savedPermissionMode : 'always_ask');
    this.toolRegistry = new ToolRegistry();

    this.editEngine = new EditEngine(context.workspaceState, context.storageUri?.scheme === 'file' ? context.storageUri.fsPath : undefined);
    this.terminalManager = new TerminalManager();
    this.agentEngine = new AgentEngine(this.toolRegistry, this.permissionManager, this.editEngine, this.terminalManager);
    this.remoteManager = new RemoteManager(context, this.compositeProvider, this.modelRegistry);
    this.sessionManager = new SessionManager(context.workspaceState);
    this.taskManager = new TaskManager(context.workspaceState);
    this.gitContextService = new GitContextService();

    this.artifactManager = new ArtifactManager();
    this.turnManager = new TurnManager(() => this.scheduleTraceSave());
    this.turnManager.restorePersistedHistory(context.workspaceState.get<unknown>('localforge.activityTraceHistory'));
    this.browserTool = new BrowserTool();
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
    for (const toolDef of allWorkspaceTools) {
      this.toolRegistry.registerTool(toolDef, (args, execution) =>
        executeWorkspaceTool(toolDef.function.name, args, {
          editEngine: this.editEngine,
          terminalManager: this.terminalManager,
          autoApply: this.permissionManager.shouldAutoApplyEdits(),
          signal: execution.signal
        })
      );
    }
    registerAllCoreTools(this.toolRegistry, {
      editEngine: this.editEngine,
      terminalManager: this.terminalManager,
      artifactManager: this.artifactManager,
      browserTool: this.browserTool,
      autoApply: () => this.permissionManager.shouldAutoApplyEdits()
    });
  }

  private initWorkspaceContext(): void {
    const roots = vscode.workspace.workspaceFolders;
    if (roots && roots.length > 0) {
      this.indexer = new WorkspaceIndexer();
      this.contextEngine = new ContextEngine(this.indexer);
      void this.indexer.indexWorkspace().then((count) => {
        this.events.emit('indexProgress', `Indexed ${count} workspace files`);
      });
    }
  }

  public async bootstrap(): Promise<void> {
    await this.modelRegistry.refresh();
    try {
      if (await this.browserTool.isAvailable()) {
        this.toolRegistry.registerTool(BROWSER_TOOL_DEFINITION, (args, execution) => this.browserTool.execute(args as any, execution.signal));
      }
    } catch {}
  }

  public getActivityHistory(conversationId: string): TurnActivity[] {
    return this.turnManager.getTurnsForConversation(conversationId)
      .slice(-12)
      .flatMap((turn) => turn.activities.slice(-32));
  }

  public async flushActivityHistory(): Promise<void> {
    if (this.traceSaveTimer) clearTimeout(this.traceSaveTimer);
    this.traceSaveTimer = undefined;
    await this.context.workspaceState.update('localforge.activityTraceHistory', this.turnManager.getPersistedHistory());
  }

  private scheduleTraceSave(): void {
    if (this.traceSaveTimer) clearTimeout(this.traceSaveTimer);
    this.traceSaveTimer = setTimeout(() => {
      this.traceSaveTimer = undefined;
      void this.context.workspaceState.update('localforge.activityTraceHistory', this.turnManager.getPersistedHistory());
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

  public async executeTask(
    userPrompt: string,
    mode: AgentMode,
    modelPreference?: string,
    onProgressOrOptions?: ((msg: string) => void) | ExecuteTaskOptions,
    legacyOnToken?: (token: string) => void
  ): Promise<AgentRunSummary> {
    this.cancelCurrentTask();
    const controller = new AbortController();
    this.currentAbortController = controller;
    try {
      return await this.executeTaskRun(controller.signal, userPrompt, mode, modelPreference, onProgressOrOptions, legacyOnToken);
    } finally {
      if (this.currentAbortController === controller) this.currentAbortController = undefined;
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
    let effectivePrompt = parsedSlash.cleanPrompt || userPrompt;

    if (parsedSlash.command) {
      switch (parsedSlash.command) {
        case 'clear': {
          const session = this.sessionManager.getActiveSession();
          session.messages = [];
          await this.sessionManager.saveSession(session);
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
          void vscode.commands.executeCommand('localforge.diagnose');
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
          void vscode.commands.executeCommand('localforge.connectRemote');
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
        throw new Error('No local LLM detected. Please ensure Ollama is running (`ollama serve`) or configure a remote GPU / OpenAI-compatible endpoint in LocalForge settings.');
      }
    }

    const session = this.sessionManager.getActiveSession();
    session.mode = effectiveMode;
    session.model = chosenModel;

    // Start turn
    const turn = this.turnManager.startTurn({
      conversationId: session.id,
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
      onProgress?.(`${category}: ${title}`);
      return act;
    };

    // 2. Resolve @ references
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const resolved = await this.referenceResolver.resolveReferences(effectivePrompt, workspaceRoot);
    effectivePrompt = resolved.cleanedPrompt;

    let contextHeader = '';
    if (resolved.references.length > 0) {
      contextHeader += 'Attached References:\n' + resolved.references.map((r) => `[${r.label}]\n${r.content}`).join('\n\n') + '\n\n';
    }

    // 3. Context retrieval - budget appropriately for local context windows
    if (this.contextEngine) {
      const isLocal = !chosenModel.startsWith('remote:') && !chosenModel.startsWith('openai:');
      const maxTokens = isLocal ? 2000 : 8000;
      const ctx = await this.contextEngine.assembleContext(effectivePrompt, { maxTokens, includeWorkspace: true });
      contextHeader += ctx.promptText;
      session.lastContextPreview = ctx.summary;
    }

    const messages: ChatMessage[] = [
      ...session.messages.slice(-10),
      {
        role: 'user',
        content: contextHeader ? `${contextHeader}\n\nTask:\n${effectivePrompt}` : effectivePrompt
      }
    ];

    const taskRecord = await this.taskManager.recordTaskStart(effectivePrompt, effectiveMode, chosenModel);

    try {
      const result = await this.agentEngine.runTask(
        this.compositeProvider,
        chosenModel,
        messages,
        {
          mode: effectiveMode,
          strategy,
          signal,
          onProgress: (p) => {
            onProgress?.(p);
          },
          onModelText: (text) => onToken?.(text),
          onModelOutput: (text, round, toolNames) => {
            if (!text.trim()) return;
            const actionLabel = toolNames.length ? ` · ${toolNames.join(', ')}` : '';
            emitActivity('Working', `Visible model update · step ${round}${actionLabel}`, 'success', text.slice(0, 3000));
          },
          onToolStart: (name, args, callId) => {
            let cat: any = 'Working';
            let title = `Running tool ${name}`;
            let targetPath: string | undefined;

            if (name === 'search_workspace') {
              cat = 'Searching';
              title = `Searching workspace for "${(args as any).query || ''}"`;
            } else if (name === 'read_workspace_file') {
              cat = 'Reading';
              targetPath = (args as any).path;
              title = `Reading ${targetPath || 'file'}`;
            } else if (name === 'write_workspace_file' || name === 'edit_workspace_file') {
              cat = 'Editing';
              targetPath = (args as any).path;
              title = `Preparing edit for ${targetPath || 'file'}`;
            } else if (name === 'run_command') {
              cat = 'Running';
              title = `Running: ${(args as any).command || ''}`;
            } else if (name === 'browser_action') {
              cat = 'Browser';
              title = `Browser action: ${(args as any).action || ''}`;
            }

            const act = this.turnManager.addActivity(turn.turnId, {
              id: callId,
              category: cat,
              title,
              status: 'running',
              targetPath,
              toolName: name,
              inputSummary: formatToolInput(name, args)
            });
            onActivity?.(act);
            onProgress?.(`${cat}: ${title}`);
            activeActivities.set(callId, act);
          },
          onToolEnd: (name, res, error, callId) => {
            const existing = callId ? activeActivities.get(callId) : undefined;
            if (existing) {
              const updated = this.turnManager.updateActivity(turn.turnId, existing.id, {
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
      if (effectiveMode === 'plan') {
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
      const pending = this.editEngine.getPendingProposals();
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

      const awaitingReview = pending.length > 0 || effectiveMode === 'plan';
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

      session.messages.push({ role: 'user', content: userPrompt });
      session.messages.push({ role: 'assistant', content: result.response });
      session.filesModified = Array.from(new Set([...session.filesModified, ...result.filesModified]));
      await this.sessionManager.saveSession(session);

      await this.taskManager.recordTaskCompletion(
        taskRecord.id,
        result.status === 'failed' || result.status === 'cancelled' ? result.status : awaitingReview ? 'waiting_for_approval' : result.status,
        result.filesModified,
        result.response.slice(0, 500)
      );

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
      throw err;
    }
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
      const editResult = await this.editEngine.applyProposal(proposalId, files, signal);
      if (!editResult.success) {
        emitAct('Editing', 'Failed to apply proposal changes', 'error', editResult.errors.map((error) => error.error).join(', '));
        this.turnManager.completeTurn(turn.turnId, 'failed');
        return editResult;
      }

      emitAct('Editing', `Applied changes to ${editResult.appliedCount} file(s)`, 'success');

      let validationPassed: boolean | undefined;
      if (workspaceRoot && editResult.appliedFiles.length > 0) {
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

      this.turnManager.completeTurn(turn.turnId, validationPassed === false ? 'failed' : 'completed', editResult.appliedFiles);
      emitAct(
        validationPassed === false ? 'Failed' : 'Completed',
        validationPassed === false ? 'Changes applied; validation needs attention' : validationPassed === true ? 'Changes applied and verified' : 'Changes applied',
        validationPassed === false ? 'error' : 'success'
      );

      session.filesModified = Array.from(new Set([...session.filesModified, ...editResult.appliedFiles]));
      await this.sessionManager.saveSession(session);
      return { ...editResult, validationPassed };
    } catch (error) {
      this.turnManager.completeTurn(turn.turnId, signal.aborted ? 'cancelled' : 'failed');
      emitAct(signal.aborted ? 'Cancelled' : 'Failed', signal.aborted ? 'Review validation cancelled; inspect any already applied changes' : 'Review application or validation failed', signal.aborted ? 'cancelled' : 'error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  public async rollbackRecordedChanges(recoveryId: string, files?: string[], onActivity?: (activity: TurnActivity) => void): Promise<EditRollbackResult> {
    if (this.isBusy()) throw new Error('Wait for the current task or cancel it before restoring changes.');
    const controller = new AbortController();
    const session = this.sessionManager.getActiveSession();
    const turn = this.turnManager.startTurn({ conversationId: session.id, modelId: session.model || '', mode: 'agent', strategy: 'fast' });
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
    const routing = this.modelRouter.route(mode === 'agent' ? 'agent' : 'chat', modelPreference);
    const chosenModel = routing.modelId;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      throw new Error('Open a workspace folder before executing multi-agent tasks.');
    }
    return this.orchestrator.executeGoal(userGoal, chosenModel, workspaceRoot, {
      ...options,
      mode
    });
  }
}
