import * as vscode from 'vscode';
import { ModelProvider } from '../../providers/modelProvider';
import { ToolRegistry } from '../toolRegistry';
import { PermissionManager } from '../permissionManager';
import { EditEngine } from '../../editing/editEngine';
import { TaskGraph, TaskGraphNode } from './taskGraph';
import { AgentPool } from './agentPool';
import { AgentManager } from './agentManager';
import {
  AgentContext,
  AgentResult,
  AgentLifecycleEvent,
  ProductMode,
  AgentRole
} from './types';
import { AgentError } from './errors';
import { inferModelCapabilities } from '../../providers/modelCapabilities';
import { getEditRequestPolicy } from '../../editing/editRequestPolicy';

export interface OrchestratorOptions {
  mode?: ProductMode;
  signal?: AbortSignal;
  maxConcurrency?: number;
  subagentTimeoutMs?: number;
  subagentMaxRounds?: number;
  onLifecycleEvent?: (event: AgentLifecycleEvent) => void;
  onProgress?: (message: string) => void;
  onThought?: (chunk: string) => void;
  onSubagentStart?: (role: AgentRole, taskId: string) => void;
  onSubagentEnd?: (role: AgentRole, taskId: string, result: AgentResult) => void;
}

export interface OrchestrationResult {
  runId: string;
  task: string;
  mode: ProductMode;
  graph: TaskGraph;
  summary: string;
  filesModified: string[];
  status: 'completed' | 'failed' | 'cancelled';
  durationMs: number;
}

import { CheckpointManager } from './checkpointManager';
import { DynamicPlanner } from './dynamicPlanner';

export class MultiAgentOrchestrator {
  private agentManager: AgentManager;
  private pool: AgentPool;

  constructor(
    private readonly provider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly editEngine?: EditEngine,
    maxConcurrency: number = 4,
    private readonly checkpointManager?: CheckpointManager
  ) {
    this.pool = new AgentPool(maxConcurrency);
    this.agentManager = new AgentManager(provider, toolRegistry, permissionManager, this.pool);
  }

  public async executeGoal(
    userGoal: string,
    model: string,
    workspaceRoot: vscode.Uri,
    options: OrchestratorOptions = {},
    workspaceContext?: { indexedFiles?: string[]; detectedTechnologies?: string[] }
  ): Promise<OrchestrationResult> {
    const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();
    const mode = options.mode ?? 'agent';

    options.onProgress?.('Orchestrator: Decomposing engineering task into TaskGraph...');

    // 1. Task Decomposition: Create DAG based on mode and goal
    const graph = this.decomposeGoal(userGoal, mode, workspaceContext);

    const filesModified: string[] = [];
    const priorDecisions: string[] = [];
    const priorHandoffs: Record<string, unknown> = {};

    try {
      while (!graph.isFinished()) {
        if (options.signal?.aborted) {
          graph.cancelAll();
          break;
        }

        const readyTasks = graph.getReadyTasks();

        if (readyTasks.length === 0) {
          if (this.pool.getActiveCount() === 0 && !graph.isFinished()) {
            // Deadlock or unresolvable failure
            throw new AgentError({
              message: 'TaskGraph execution deadlocked: no ready tasks and no active subagents.',
              code: 'TASK_GRAPH_DEADLOCK'
            });
          }
          // Wait briefly for in-flight tasks to progress
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }

        // Execute available tasks respecting concurrency limits
        const concurrency = Math.max(1, Math.min(16, options.maxConcurrency ?? this.pool.getCapacity()));
        const slots = Math.min(this.pool.getAvailableSlots(), Math.max(0, concurrency - this.pool.getActiveCount()));
        if (!slots) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
        const tasksToRun = readyTasks.slice(0, slots);

        await Promise.all(
          tasksToRun.map(async (taskNode) => {
            graph.markRunning(taskNode.id);
            options.onSubagentStart?.(taskNode.role, taskNode.id);
            options.onProgress?.(`Dispatching subagent [${taskNode.role}] for: ${taskNode.title}`);

            const context: AgentContext = {
              agentId: `agent-${taskNode.role}-${Date.now()}`,
              role: taskNode.role,
              task: `${taskNode.title}: ${taskNode.description}`,
              parentTaskId: runId,
              workspaceRoot,
              relevantFiles: taskNode.targetFiles,
              priorAgentDecisions: [...priorDecisions],
              priorToolOutputs: { ...priorHandoffs },
              modelCapabilities: inferModelCapabilities(model),
              toolPermissions: ['read', 'edit', 'execute'],
              budget: {
                maxTokens: 16000,
                maxRounds: options.subagentMaxRounds ?? 24,
                maxToolCalls: 4,
                timeoutMs: options.subagentTimeoutMs ?? 0,
                retryLimit: 2
              },
              signal: options.signal,
              editRequestPolicy: getEditRequestPolicy(userGoal)
            };

            const execute = () => this.agentManager.executeSubagent(context, model, {
              onLifecycleEvent: options.onLifecycleEvent,
              onProgress: options.onProgress,
              onThought: options.onThought
            });
            const result = this.editEngine ? await this.editEngine.withRequestPolicy(context.editRequestPolicy!, execute) : await execute();

            for (const file of result.filesModified) if (!filesModified.includes(file)) filesModified.push(file);
            if (result.status === 'completed') {
              graph.markCompleted(taskNode.id, result);
              priorDecisions.push(`[${taskNode.role}] ${result.output.slice(0, 150)}`);
              if (result.handoff) {
                priorHandoffs[taskNode.id] = result.handoff;
              }
              for (const file of result.filesModified) {
                if (!filesModified.includes(file)) {
                  filesModified.push(file);
                }
              }
              options.onSubagentEnd?.(taskNode.role, taskNode.id, result);

              // Persist intermediate checkpoint
              if (this.checkpointManager) {
                await this.checkpointManager.saveCheckpoint({
                  runId,
                  task: userGoal,
                  mode,
                  graph: graph.serialize(),
                  filesModified,
                  timestamp: Date.now(),
                  status: 'running'
                });
              }
            } else if (result.status === 'cancelled') {
              graph.markCancelled(taskNode.id);
            } else {
              const willRetry = graph.markFailed(taskNode.id, result.error || 'Execution failed');
              if (willRetry) {
                options.onProgress?.(`Retrying failed subtask: ${taskNode.title}...`);
              }
            }
          })
        );
      }

      const isCancelled = Boolean(options.signal?.aborted);
      const isSuccess = graph.isComplete() && !graph.hasFailures();

      let summaryText = '';
      const completedNodes = graph.getAllNodes().filter((n) => n.status === 'completed');
      if (completedNodes.length > 0) {
        summaryText = completedNodes
          .map((n) => `### ${n.title} (${n.role})\n${n.result?.output || 'Completed.'}`)
          .join('\n\n');
      } else {
        summaryText = isCancelled ? 'Task was cancelled by user.' : 'Task execution failed.';
      }

      if (this.checkpointManager) {
        await this.checkpointManager.saveCheckpoint({
          runId,
          task: userGoal,
          mode,
          graph: graph.serialize(),
          filesModified,
          timestamp: Date.now(),
          status: isCancelled ? 'interrupted' : isSuccess ? 'completed' : 'failed'
        });
      }

      return {
        runId,
        task: userGoal,
        mode,
        graph,
        summary: summaryText,
        filesModified,
        status: isCancelled ? 'cancelled' : isSuccess ? 'completed' : 'failed',
        durationMs: Date.now() - startTime
      };
    } catch (err: any) {
      graph.cancelAll();
      if (this.checkpointManager) {
        await this.checkpointManager.markInterrupted();
      }
      return {
        runId,
        task: userGoal,
        mode,
        graph,
        summary: `Orchestration error: ${err.message || String(err)}`,
        filesModified,
        status: options.signal?.aborted ? 'cancelled' : 'failed',
        durationMs: Date.now() - startTime
      };
    }
  }

  public decomposeGoal(
    goal: string,
    mode: ProductMode,
    workspaceContext?: { indexedFiles?: string[]; detectedTechnologies?: string[] }
  ): TaskGraph {
    if (mode === 'ask') {
      const graph = new TaskGraph();
      graph.addNode({
        id: 'task-inspect',
        title: 'Repository Inspection',
        description: `Analyze workspace to answer: "${goal}"`,
        role: 'repository_analyst',
        dependencies: [],
        targetFiles: workspaceContext?.indexedFiles?.slice(0, 5) ?? [],
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    if (mode === 'plan') {
      const plan = DynamicPlanner.planGoal(goal, workspaceContext);
      return DynamicPlanner.buildTaskGraph(plan);
    }

    if (mode === 'review') {
      const graph = new TaskGraph();
      const files = workspaceContext?.indexedFiles ?? [];
      graph.addNode({
        id: 'task-diff-review',
        title: 'Code Review & Regression Analysis',
        description: 'Review git diff and verify code quality against standards.',
        role: 'reviewer',
        dependencies: [],
        targetFiles: files.slice(0, 10),
        priority: 'high',
        maxRetries: 1
      });
      graph.addNode({
        id: 'task-security-review',
        title: 'Security Vulnerability Audit',
        description: 'Audit modified files for injection, path escapes, and credential exposure.',
        role: 'security_reviewer',
        dependencies: ['task-diff-review'],
        targetFiles: files.slice(0, 10),
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    // Default AGENT / autonomous engineering mode:
    // Generate dynamic task DAG using DynamicPlanner with candidate file prediction and topological validation
    try {
      const plan = DynamicPlanner.planGoal(goal, workspaceContext);
      return DynamicPlanner.buildTaskGraph(plan);
    } catch {
      // Fallback to structured DAG with candidate targetFiles if planner heuristics fail
      const graph = new TaskGraph();
      const detected = workspaceContext?.indexedFiles ?? [];
      graph.addNode({
        id: 'task-plan',
        title: 'Analyze & Plan Implementation',
        description: `Analyze workspace and plan execution for: "${goal}"`,
        role: 'planner',
        dependencies: [],
        targetFiles: detected.slice(0, 5),
        priority: 'high',
        maxRetries: 1
      });
      graph.addNode({
        id: 'task-code',
        title: 'Implement Changes',
        description: `Implement code modifications according to plan for: "${goal}"`,
        role: 'coder',
        dependencies: ['task-plan'],
        targetFiles: detected.slice(0, 5),
        priority: 'urgent',
        maxRetries: 2
      });
      graph.addNode({
        id: 'task-test',
        title: 'Run Automated Tests & Validation',
        description: 'Run project tests to confirm absence of regressions.',
        role: 'test_engineer',
        dependencies: ['task-code'],
        targetFiles: detected.filter((f) => f.includes('test')),
        priority: 'high',
        maxRetries: 2
      });
      graph.addNode({
        id: 'task-review',
        title: 'Code & Security Review',
        description: 'Inspect modified files for bugs, security risks, and code quality.',
        role: 'reviewer',
        dependencies: ['task-test'],
        targetFiles: detected.slice(0, 5),
        priority: 'medium',
        maxRetries: 1
      });
      return graph;
    }
  }
}
