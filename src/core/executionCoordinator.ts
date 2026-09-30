import * as vscode from 'vscode';
import { AgentRunSummary } from '../agent/agentEngine';
import { AgentMode } from '../agent/agentLoop';
import { OrchestrationResult, MultiAgentOrchestrator, OrchestratorOptions } from '../agent/orchestration/orchestrator';
import { ProductMode } from '../agent/orchestration/types';
import { CheckpointManager } from '../agent/orchestration/checkpointManager';
import { ModelRouter } from '../providers/modelRouter';

export interface CoordinateOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onToken?: (token: string) => void;
}

export class ExecutionCoordinator {
  constructor(
    private readonly orchestrator: MultiAgentOrchestrator,
    private readonly modelRouter: ModelRouter,
    private readonly checkpointManager: CheckpointManager
  ) {}

  public async execute(
    prompt: string,
    mode: AgentMode,
    modelPreference: string | undefined,
    options: CoordinateOptions = {}
  ): Promise<AgentRunSummary> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) throw new Error('Open a workspace folder before executing an engineering task.');

    const productMode: ProductMode = mode === 'agent' ? 'agent' : mode;
    const routing = this.modelRouter.route(
      productMode === 'agent' ? 'agent' : 'chat',
      modelPreference
    );
    const chosenModel = routing.modelId;

    const coordinatorRunId = 'coord-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    await this.checkpointManager.saveCheckpoint({
      runId: coordinatorRunId,
      task: prompt,
      mode: productMode,
      graph: { nodes: [] },
      filesModified: [],
      timestamp: Date.now(),
      status: 'running'
    });

    const orchestratorOptions: OrchestratorOptions = {
      mode: productMode,
      signal: options.signal,
      onProgress: options.onProgress,
      onThought: options.onToken
    };

    let result: OrchestrationResult;
    try {
      result = await this.orchestrator.executeGoal(prompt, chosenModel, workspaceRoot, orchestratorOptions);
    } catch (error) {
      await this.checkpointManager.saveCheckpoint({
        runId: coordinatorRunId,
        task: prompt,
        mode: productMode,
        graph: { nodes: [] },
        filesModified: [],
        timestamp: Date.now(),
        status: options.signal?.aborted ? 'interrupted' : 'failed'
      });
      throw error;
    }

    if (result.status === 'completed') {
      await this.checkpointManager.clearCheckpoint();
    }

    return {
      runId: result.runId,
      task: result.task,
      mode,
      response: result.summary,
      filesModified: result.filesModified,
      validationAttempts: [],
      status: result.status,
      durationMs: result.durationMs
    };
  }
}
