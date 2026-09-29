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
import { allWorkspaceTools, executeWorkspaceTool, validateRelativeWorkspacePath } from '../agent/workspaceTools';
import { ArtifactManager, Artifact } from './artifactManager';
import { TurnManager, AgentTurn, TurnActivity, ExecutionStrategy } from './turnManager';
import { TerminalManager } from '../terminal/terminalManager';
import { BrowserTool, BROWSER_TOOL_DEFINITION } from '../browser/browserTool';
import { ContextReferenceResolver } from '../context/referenceResolver';

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

  public indexer?: WorkspaceIndexer;
  public contextEngine?: ContextEngine;

  private currentAbortController?: AbortController;
  private activeConversationId?: string;
  private activeTurnId?: string;

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
    this.remoteManager = new RemoteManager(context, this.compositeProvider, this.modelRegistry);
    this.sessionManager = new SessionManager(context.workspaceState);
    this.taskManager = new TaskManager(context.workspaceState);
    this.gitContextService = new GitContextService();

    this.artifactManager = new ArtifactManager();
    this.turnManager = new TurnManager();
    this.terminalManager = new TerminalManager();
    this.toolRegistry.setEditProposalHandler((toolName, args) => this.createEditProposal(toolName, args));
    this.toolRegistry.setCommandExecutionHandler((command, cwd) => this.terminalManager.runCommand(command, cwd, false, 60000));
    this.browserTool = new BrowserTool();
    this.referenceResolver = new ContextReferenceResolver(this.gitContextService, this.terminalManager);

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
      void this.indexer.indexWorkspace().then((count) => {
        this.events.emit('indexProgress', `Indexed ${count} workspace files`);
      });
    }
  }

  public async bootstrap(): Promise<void> {
    await this.modelRegistry.refresh();
    try {
      if (await this.browserTool.isAvailable()) {
        this.toolRegistry.registerTool(BROWSER_TOOL_DEFINITION, (args) => this.browserTool.execute(args as any));
      }
    } catch {}
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

  public async runSelfTest(): Promise<{
    ok: boolean;
    workspace: string;
    filePath: string;
    command: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) throw new Error('Open a workspace before running the LocalForge self-test.');

    const smokeDir = vscode.Uri.joinPath(root, '.localforge-smoke');
    const scriptUri = vscode.Uri.joinPath(smokeDir, 'hello.js');
    const scriptContent = 'console.log("LocalForge working");\n';
    const commandExecutable = process.execPath.includes(' ')
      ? '"' + process.execPath.replace(/"/g, '\\\"') + '"'
      : process.execPath;
    const command = commandExecutable + ' hello.js';

    try {
      await vscode.workspace.fs.createDirectory(smokeDir);
      await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(scriptContent, 'utf8'));

      const processResult = await this.terminalManager.runCommand(
        command,
        smokeDir.fsPath,
        false,
        15000
      );

      const ok = processResult.status === 'completed'
        && processResult.exitCode === 0
        && processResult.stdout.includes('LocalForge working');

      if (!ok) {
        throw new Error(
          'LocalForge self-test failed. Exit code: ' + processResult.exitCode
          + '\\nstdout: ' + processResult.stdout
          + '\\nstderr: ' + processResult.stderr
        );
      }

      return {
        ok,
        workspace: root.fsPath,
        filePath: vscode.workspace.asRelativePath(scriptUri),
        command: processResult.command,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        exitCode: processResult.exitCode ?? -1
      };
    } finally {
      try {
        await vscode.workspace.fs.delete(smokeDir, { recursive: true, useTrash: false });
      } catch {}
    }
  }

  private async createEditProposal(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!vscode.workspace.isTrusted) throw new Error('Workspace edits require a trusted workspace.');
    const roots = vscode.workspace.workspaceFolders ?? [];
    if (!roots.length) throw new Error('Open a workspace folder before editing.');
    const root = roots[0].uri;
    const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
    if (!rawPath) throw new Error('Edit tool requires a workspace-relative path.');
    const segments = validateRelativeWorkspacePath(rawPath);
    const path = segments.join('/');

    let newContent = '';
    if (toolName === 'write_workspace_file') {
      newContent = typeof args.content === 'string' ? args.content : '';
    } else {
      const target = typeof args.target_content === 'string' ? args.target_content : '';
      const replacement = typeof args.replacement_content === 'string' ? args.replacement_content : '';
      if (!target) throw new Error('edit_workspace_file requires target_content.');
      const uri = vscode.Uri.joinPath(root, ...segments);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const existing = new TextDecoder().decode(bytes);
      const occurrences = existing.split(target).length - 1;
      if (occurrences === 0) throw new Error('Target content was not found in ' + path + '.');
      if (occurrences > 1) throw new Error('Target content occurs multiple times in ' + path + '.');
      newContent = existing.replace(target, replacement);
    }

    if (newContent.length > 512 * 1024) throw new Error('Proposed file content exceeds the 512 KB safety limit.');
    const proposal = await this.editEngine.proposeEdits(
      root,
      [{ path, newContent }],
      toolName === 'write_workspace_file' ? 'Create or replace ' + path : 'Edit ' + path,
      { conversationId: this.activeConversationId, turnId: this.activeTurnId }
    );
    return {
      requiresApproval: true,
      proposalId: proposal.id,
      message: 'Prepared changes for review. Review and apply them before the agent continues.',
      files: proposal.files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions }))
    };
  }

  public async executeTask(
    userPrompt: string,
    mode: AgentMode,
    modelPreference?: string,
    onProgressOrOptions?: ((msg: string) => void) | ExecuteTaskOptions,
    legacyOnToken?: (token: string) => void
  ): Promise<AgentRunSummary> {
    this.cancelCurrentTask();
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

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
            const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (rootPath) {
              const proc = await this.toolRegistry.executeTool(
                'run_command',
                { command: effectivePrompt, cwd: rootPath },
                this.permissionManager
              ) as any;
              return {
                runId: `run-${Date.now()}`,
                task: `Run terminal command: ${effectivePrompt}`,
                mode: effectiveMode,
                response: `Command: \\`${proc.command}\\`\\nExit Code: ${proc.exitCode}\\n\\n\\`\\`\\`\\n${proc.stdout || proc.stderr || '(no output)'}\\n\\`\\`\\``,
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

    const taskType: TaskType = effectiveMode === 'agent' ? 'agent' : 'chat';
    const routing = this.modelRouter.route(taskType, modelPreference);
    const chosenModel = routing.modelId;

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
    this.activeConversationId = session.id;
    this.activeTurnId = turn.turnId;

    const emitActivity = (category: any, title: string, details?: string, targetPath?: string) => {
      const act = this.turnManager.addActivity(turn.turnId, {
        category,
        title,
        details,
        targetPath,
        status: 'running'
      });
      onActivity?.(act);
      onProgress?.(`${category}: ${title}`);
    };

    // 2. Resolve @ references
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    const resolved = await this.referenceResolver.resolveReferences(effectivePrompt, workspaceRoot);
    effectivePrompt = resolved.cleanedPrompt;

    let contextHeader = '';
    if (resolved.references.length > 0) {
      contextHeader += 'Attached References:\n' + resolved.references.map((r) => `[${r.label}]\n${r.content}`).join('\n\n') + '\n\n';
    }

    // 3. Context retrieval
    if (this.contextEngine) {
      emitActivity('Searching', 'Analyzing workspace context');
      const ctx = await this.contextEngine.assembleContext(effectivePrompt, { maxTokens: 16000, includeWorkspace: true });
      contextHeader += ctx.promptText;
      session.lastContextPreview = ctx.summary;
    }

    emitActivity('Working', 'Sending task to selected model');

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
          signal,
          timeoutMs: 120000,
          onProgress: (p) => {
            onProgress?.(p);
            onActivity?.(this.turnManager.addActivity(turn.turnId, { category: 'Working', title: p, status: 'running' }));
          },
          onStateUpdate: (state) => {
            if (state.status === 'planning') onActivity?.(this.turnManager.addActivity(turn.turnId, { category: 'Planning', title: 'Agent is planning the next step', status: 'running' }));
            if (state.status === 'waiting_for_approval') onActivity?.(this.turnManager.addActivity(turn.turnId, { category: 'Waiting for approval', title: 'Changes are waiting for your review', status: 'running' }));
          },
          onThought: undefined,
          onToolStart: (name, args, _id) => {
            if (name === 'search_workspace') {
              emitActivity('Searching', `Searching workspace for "${(args as any).query || ''}"`);
            } else if (name === 'read_workspace_file') {
              emitActivity('Reading', `Reading file ${(args as any).path || ''}`, undefined, (args as any).path);
            } else if (name === 'write_workspace_file' || name === 'edit_workspace_file') {
              emitActivity('Editing', `Preparing edit for ${(args as any).path || ''}`, undefined, (args as any).path);
            } else if (name === 'run_command') {
              emitActivity('Running', `Running: ${(args as any).command || ''}`);
            } else if (name === 'browser_action') {
              emitActivity('Browser', `Browser action: ${(args as any).action || ''}`);
            } else {
              emitActivity('Working', `Running tool: ${name}`);
            }
          },
          onToolEnd: (name, result, error, _id) => {
            let details: string | undefined;
            if (name === 'run_command' && result && typeof result === 'object') {
              const terminal = result as { exitCode?: number; stdout?: string; stderr?: string; durationMs?: number; status?: string };
              details = [
                terminal.exitCode !== undefined ? 'Exit code: ' + terminal.exitCode : '',
                terminal.durationMs !== undefined ? 'Duration: ' + terminal.durationMs + ' ms' : '',
                terminal.stdout ? terminal.stdout.slice(0, 4000) : '',
                terminal.stderr ? terminal.stderr.slice(0, 3000) : ''
              ].filter(Boolean).join('\\n');
            }
            onActivity?.(this.turnManager.addActivity(turn.turnId, {
              category: error ? 'Failed' : name === 'run_command' ? 'Running' : 'Working',
              title: error ? `Failed ${name}: ${error}` : `Completed ${name}`,
              details,
              status: error ? 'error' : 'success'
            }));
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
        emitActivity('Planning', 'Implementation Plan prepared for review');
      }

      if (result.status === 'waiting_for_approval') {
        this.turnManager.completeTurn(turn.turnId, 'waiting_for_approval', []);
        emitActivity('Waiting for approval', 'Review Changes before applying edits');
      }

      // Handle Walkthrough artifact creation if files were modified
      if (result.status !== 'waiting_for_approval' && effectiveMode === 'agent' && result.filesModified.length > 0) {
        const walkthrough = this.artifactManager.createWalkthrough({
          summary: `Completed changes for: ${effectivePrompt.slice(0, 80)}`,
          filesChanged: result.filesModified,
          behaviorChanges: 'Implemented requested code changes and verified against project structure.',
          testsRun: result.validationAttempts.length ? `${result.validationAttempts.length} test run(s)` : 'None configured',
          validationResult: result.validationAttempts.every((v) => v.result.passed) ? 'All validation checks passed' : 'Validation check failed',
          verificationSteps: 'Inspect changes in diff view and verify project operation.',
          conversationId: session.id,
          turnId: turn.turnId
        });
        this.turnManager.addArtifact(turn.turnId, walkthrough);
        onArtifact?.(walkthrough);
      }

      if (result.status !== 'waiting_for_approval') {
        this.turnManager.completeTurn(turn.turnId, result.status === 'completed' ? 'completed' : 'failed', result.filesModified);
        emitActivity(result.status === 'completed' ? 'Completed' : 'Failed', result.status === 'completed' ? 'Task completed' : 'Task failed');
      }

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
    } catch (err: any) {
      this.turnManager.completeTurn(turn.turnId, signal.aborted ? 'cancelled' : 'failed');
      emitActivity(signal.aborted ? 'Cancelled' : 'Failed', signal.aborted ? 'Task cancelled' : 'Task execution failed');
      throw err;
    } finally {
      this.currentAbortController = undefined;
      this.activeConversationId = undefined;
      this.activeTurnId = undefined;
    }
  }
}
