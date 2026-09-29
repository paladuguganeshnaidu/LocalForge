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

export interface OrchestratorOptions {
  mode?: ProductMode;
  signal?: AbortSignal;
  maxConcurrency?: number;
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

export class MultiAgentOrchestrator {
  private agentManager: AgentManager;
  private pool: AgentPool;

  constructor(
    private readonly provider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly editEngine?: EditEngine,
    maxConcurrency: number = 4
  ) {
    this.pool = new AgentPool(maxConcurrency);
    this.agentManager = new AgentManager(provider, toolRegistry, permissionManager, this.pool);
  }

  public async executeGoal(
    userGoal: string,
    model: string,
    workspaceRoot: vscode.Uri,
    options: OrchestratorOptions = {}
  ): Promise<OrchestrationResult> {
    const runId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();
    const mode = options.mode ?? 'agent';

    options.onProgress?.('Orchestrator: Decomposing engineering task into TaskGraph...');

    // 1. Task Decomposition: Create DAG based on mode and goal
    const graph = this.decomposeGoal(userGoal, mode);

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
        const tasksToRun = readyTasks.slice(0, Math.max(1, 4 - this.pool.getActiveCount()));

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
                maxRounds: 6,
                maxToolCalls: 4,
                timeoutMs: 120000,
                retryLimit: 2
              },
              signal: options.signal
            };

            const result = await this.agentManager.executeSubagent(context, model, {
              onLifecycleEvent: options.onLifecycleEvent,
              onProgress: options.onProgress,
              onThought: options.onThought
            });

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

  public decomposeGoal(goal: string, mode: ProductMode): TaskGraph {
    const graph = new TaskGraph();

    if (mode === 'ask') {
      graph.addNode({
        id: 'task-inspect',
        title: 'Repository Inspection',
        description: `Analyze workspace to answer: "${goal}"`,
        role: 'repository_analyst',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    if (mode === 'plan') {
      graph.addNode({
        id: 'task-plan',
        title: 'Architecture & Implementation Planning',
        description: `Create detailed implementation plan for: "${goal}"`,
        role: 'planner',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    if (mode === 'review') {
      graph.addNode({
        id: 'task-diff-review',
        title: 'Code Review & Regression Analysis',
        description: 'Review git diff and verify code quality against standards.',
        role: 'reviewer',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      graph.addNode({
        id: 'task-security-review',
        title: 'Security Vulnerability Audit',
        description: 'Audit modified files for injection, path escapes, and credential exposure.',
        role: 'security_reviewer',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    // Default AGENT mode: Decompose into Plan -> Code -> Test -> Review
    const isSmallTask = goal.length < 50 && !goal.toLowerCase().includes('refactor') && !goal.toLowerCase().includes('architecture');

    if (isSmallTask) {
      graph.addNode({
        id: 'task-code',
        title: 'Code Implementation',
        description: goal,
        role: 'coder',
        dependencies: [],
        targetFiles: [],
        priority: 'high',
        maxRetries: 2
      });
      graph.addNode({
        id: 'task-verify',
        title: 'Test Verification',
        description: 'Verify project build and run tests to validate changes.',
        role: 'test_engineer',
        dependencies: ['task-code'],
        targetFiles: [],
        priority: 'high',
        maxRetries: 1
      });
      return graph;
    }

    // Full Autonomous Multi-Agent Pipeline
    graph.addNode({
      id: 'task-plan',
      title: 'Analyze & Plan Implementation',
      description: `Analyze workspace and plan execution for: "${goal}"`,
      role: 'planner',
      dependencies: [],
      targetFiles: [],
      priority: 'high',
      maxRetries: 1
    });

    graph.addNode({
      id: 'task-code',
      title: 'Implement Changes',
      description: `Implement code modifications according to plan for: "${goal}"`,
      role: 'coder',
      dependencies: ['task-plan'],
      targetFiles: [],
      priority: 'urgent',
      maxRetries: 2
    });

    graph.addNode({
      id: 'task-test',
      title: 'Run Automated Tests & Validation',
      description: 'Run project tests to confirm absence of regressions.',
      role: 'test_engineer',
      dependencies: ['task-code'],
      targetFiles: [],
      priority: 'high',
      maxRetries: 2
    });

    graph.addNode({
      id: 'task-review',
      title: 'Code & Security Review',
      description: 'Inspect modified files for bugs, security risks, and code quality.',
      role: 'reviewer',
      dependencies: ['task-test'],
      targetFiles: [],
      priority: 'medium',
      maxRetries: 1
    });

    return graph;
  }
}
