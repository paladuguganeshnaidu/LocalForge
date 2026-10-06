import * as vscode from 'vscode';
import { ModelCapabilities } from '../../providers/modelCapabilities';
import { ModelToolDefinition } from '../../providers/modelProvider';
import { ToolCategory } from '../permissionManager';
import { EditRequestPolicy } from '../../editing/editRequestPolicy';

export type AgentRole =
  | 'orchestrator'
  | 'planner'
  | 'architect'
  | 'repository_analyst'
  | 'researcher'
  | 'coder'
  | 'test_engineer'
  | 'tester'
  | 'debugger'
  | 'reviewer'
  | 'security_reviewer'
  | 'performance_agent'
  | 'documentation_agent'
  | 'git_agent'
  | 'designer';

export type AgentLifecycleState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'DISCOVERING'
  | 'CONTEXT_BUILDING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'OBSERVING'
  | 'REASONING'
  | 'APPLYING'
  | 'VALIDATING'
  | 'REPAIRING'
  | 'WAITING_FOR_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export interface AgentLifecycleEvent {
  runId: string;
  parentRunId?: string;
  taskId: string;
  agentId: string;
  role: AgentRole;
  state: AgentLifecycleState;
  timestamp: number;
  duration?: number;
  metadata?: Record<string, unknown>;
  reason?: string;
}

export type ProductMode = 'ask' | 'plan' | 'agent' | 'review' | 'automate';

export interface AgentBudget {
  maxTokens: number;
  maxRounds: number;
  maxToolCalls: number;
  timeoutMs: number;
  retryLimit: number;
}

export interface AgentContext {
  agentId: string;
  role: AgentRole;
  task: string;
  parentTaskId?: string;
  workspaceRoot: vscode.Uri;
  allowedPaths?: string[];
  relevantFiles: string[];
  repositoryIndexSummary?: string;
  relevantSearchResults?: Array<{ path: string; line: number; snippet: string }>;
  currentGitDiff?: string;
  priorToolOutputs?: Record<string, unknown>;
  priorAgentDecisions?: string[];
  taskDependencies?: string[];
  modelCapabilities: ModelCapabilities;
  toolPermissions: ToolCategory[];
  budget: AgentBudget;
  signal?: AbortSignal;
  editRequestPolicy?: EditRequestPolicy;
}

export interface PlannerHandoff {
  taskId: string;
  summary: string;
  assumptions: string[];
  affectedFiles: string[];
  acceptanceCriteria: string[];
  risks: string[];
  recommendedAgents: AgentRole[];
  orderedSubtasks: Array<{
    id: string;
    title: string;
    description: string;
    role: AgentRole;
    dependencies: string[];
    targetFiles: string[];
  }>;
}

export interface CoderHandoff {
  taskId: string;
  changedFiles: string[];
  operations: Array<{ type: 'create' | 'modify' | 'delete'; path: string; linesChanged?: number }>;
  testsAdded: string[];
  knownIssues: string[];
  remainingRisks: string[];
  summary: string;
}

export interface FailureObservation {
  command?: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  stack?: string;
  file?: string;
  line?: number;
  category:
    | 'compile_error'
    | 'lint_error'
    | 'test_failure'
    | 'runtime_error'
    | 'dependency_failure'
    | 'environment_failure'
    | 'permission_failure'
    | 'timeout'
    | 'model_failure'
    | 'tool_failure';
  probableCause: string;
}

export interface TesterHandoff {
  taskId: string;
  testsRun: number;
  passed: boolean;
  failedCount: number;
  failures: FailureObservation[];
  reproductionCommand?: string;
  summary: string;
}

export interface ReviewFinding {
  severity: 'blocker' | 'critical' | 'warning' | 'suggestion';
  file: string;
  line?: number;
  description: string;
  recommendation: string;
}

export interface ReviewerHandoff {
  taskId: string;
  findings: ReviewFinding[];
  severity: 'clean' | 'warnings' | 'rejected';
  affectedFiles: string[];
  requiredChanges: string[];
  approved: boolean;
  summary: string;
}

export interface SecurityFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe?: string;
  file?: string;
  line?: number;
  issue: string;
  remediation: string;
}

export interface SecurityHandoff {
  taskId: string;
  findings: SecurityFinding[];
  passed: boolean;
  riskSummary: string;
}

export type AgentHandoff =
  | { type: 'planner'; data: PlannerHandoff }
  | { type: 'coder'; data: CoderHandoff }
  | { type: 'tester'; data: TesterHandoff }
  | { type: 'reviewer'; data: ReviewerHandoff }
  | { type: 'security'; data: SecurityHandoff }
  | { type: 'generic'; data: Record<string, unknown> };

export interface AgentResult {
  runId: string;
  agentId: string;
  role: AgentRole;
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  output: string;
  filesModified: string[];
  handoff?: AgentHandoff;
  durationMs: number;
  error?: string;
}
