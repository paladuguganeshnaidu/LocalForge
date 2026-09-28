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
import { PermissionManager } from '../agent/permissionManager';
import { AgentEngine, AgentRunSummary } from '../agent/agentEngine';
import { AgentMode } from '../agent/agentLoop';
import { EditEngine } from '../editing/editEngine';
import { RemoteManager } from '../remote/remoteManager';
import { SessionManager } from './sessionManager';
import { TaskManager } from './taskManager';
import { DiagnosticsService } from './diagnosticsService';
import { LocalForgeEventEmitter } from './events';
import { allWorkspaceTools, executeWorkspaceTool } from '../agent/workspaceTools';

export interface EngineInitOptions {
  ollamaEndpoint?: string;
  openAiEndpoint?: string;
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

  public indexer?: WorkspaceIndexer;
  public contextEngine?: ContextEngine;

  private currentAbortController?: AbortController;

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
    this.modelRegistry.registerProvider(localOllama, 'local', ollamaUrl);
    if (options.openAiEndpoint) {
      this.modelRegistry.registerProvider(new OpenAiCompatibleProvider('openai', options.openAiEndpoint), 'local', options.openAiEndpoint);
    }

    this.modelRouter = new ModelRouter(() => this.modelRegistry.getModels());

    this.permissionManager = new PermissionManager('allow_safe_auto');
    this.toolRegistry = new ToolRegistry();
    this.registerDefaultTools();

    this.editEngine = new EditEngine();
    this.agentEngine = new AgentEngine(this.toolRegistry, this.permissionManager, this.editEngine);
    this.remoteManager = new RemoteManager(context, this.compositeProvider);
    this.sessionManager = new SessionManager(context.workspaceState);
    this.taskManager = new TaskManager(context.workspaceState);
    this.gitContextService = new GitContextService();

    this.initWorkspaceContext();

    this.diagnosticsService = new DiagnosticsService(
      this.modelRegistry,
      this.remoteManager,
      this.indexer
    );
  }

  private registerDefaultTools(): void {
    for (const toolDef of allWorkspaceTools) {
      this.toolRegistry.registerTool(toolDef, (args) => executeWorkspaceTool(toolDef.function.name, args));
    }
  }

  private initWorkspaceContext(): void {
    const roots = vscode.workspace.workspaceFolders;
    if (roots && roots.length > 0) {
      this.indexer = new WorkspaceIndexer();
      this.contextEngine = new ContextEngine(this.indexer);
      // Run indexing in background
      void this.indexer.indexWorkspace().then((count) => {
        this.events.emit('indexProgress', `Indexed ${count} workspace files`);
      });
    }
  }

  public async bootstrap(): Promise<void> {
    await this.modelRegistry.refresh();
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
    onProgress?: (msg: string) => void,
    onToken?: (token: string) => void
  ): Promise<AgentRunSummary> {
    this.cancelCurrentTask();
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    const taskType: TaskType = mode === 'agent' ? 'agent' : 'chat';
    const routing = this.modelRouter.route(taskType, modelPreference);
    const chosenModel = routing.modelId;

    const session = this.sessionManager.getActiveSession();
    session.mode = mode;
    session.model = chosenModel;

    // Build context
    let contextHeader = '';
    if (this.contextEngine) {
      onProgress?.('Gathering workspace context...');
      const ctx = await this.contextEngine.assembleContext(userPrompt, { maxTokens: 16000, includeWorkspace: true });
      contextHeader = ctx.promptText;
      session.lastContextPreview = ctx.summary;
    }

    const messages: ChatMessage[] = [
      ...session.messages.slice(-10),
      {
        role: 'user',
        content: contextHeader ? `${contextHeader}\n\nTask:\n${userPrompt}` : userPrompt
      }
    ];

    const taskRecord = await this.taskManager.recordTaskStart(userPrompt, mode, chosenModel);

    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const result = await this.agentEngine.runTask(
        this.compositeProvider,
        chosenModel,
        messages,
        {
          mode,
          signal,
          onProgress,
          onThought: onToken,
          onToolStart: (name, _args, _id) => {
            onProgress?.(`Running tool: ${name}`);
          }
        },
        workspaceRoot
      );

      session.messages.push({ role: 'user', content: userPrompt });
      session.messages.push({ role: 'assistant', content: result.response });
      session.filesModified = Array.from(new Set([...session.filesModified, ...result.filesModified]));
      await this.sessionManager.saveSession(session);

      await this.taskManager.recordTaskCompletion(
        taskRecord.id,
        result.status,
        result.filesModified,
        result.response.slice(0, 500)
      );

      return result;
    } finally {
      this.currentAbortController = undefined;
    }
  }
}
