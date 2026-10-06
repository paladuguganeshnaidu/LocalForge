import * as crypto from 'crypto';

export type RunState =
  | 'idle'
  | 'initializing'
  | 'planning'
  | 'executing'
  | 'paused'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunStateTransitionEvent {
  runId: string;
  from: RunState;
  to: RunState;
  timestamp: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface RunBudget {
  maxDurationMs: number;
  maxToolCalls: number;
  maxTokens: number;
  maxChildAgents: number;
  maxFilesMutated: number;
}

export interface RunBudgetUsage {
  elapsedMs: number;
  toolCalls: number;
  tokens: number;
  childAgents: number;
  filesMutated: number;
}

export interface RunBudgetViolation {
  dimension: keyof RunBudget;
  limit: number;
  actual: number;
  message: string;
}

export interface RunManifest {
  schemaVersion: number;
  runId: string;
  goal: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
  workspaceFingerprint: string;
  executionTier: string;
  status: RunState;
  budget?: RunBudget;
  evidenceIds: string[];
}

export interface ResourceLease {
  id: string;
  runId: string;
  resourceType: 'file' | 'worktree' | 'process' | 'port' | 'lock';
  resourceKey: string;
  acquiredAt: number;
  release: () => Promise<void> | void;
}

export function createRunId(): string {
  return `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createTaskId(): string {
  return `task_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createAgentId(role = 'agent'): string {
  return `${role}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createToolCallId(toolName = 'tool'): string {
  return `call_${toolName}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createApprovalId(): string {
  return `appr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function createArtifactId(kind = 'artifact'): string {
  return `art_${kind}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}
