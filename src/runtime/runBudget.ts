import { EventEmitter } from 'events';
import { RunBudget, RunBudgetUsage, RunBudgetViolation } from './types';

export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxDurationMs: 600_000, // 10 minutes
  maxToolCalls: 200,
  maxTokens: 500_000,
  maxChildAgents: 16,
  maxFilesMutated: 100
};

export class RunBudgetManager extends EventEmitter {
  private readonly budget: RunBudget;
  private readonly startTime: number;
  private toolCallCount = 0;
  private tokenCount = 0;
  private childAgentCount = 0;
  private readonly mutatedFiles = new Set<string>();

  constructor(customBudget?: Partial<RunBudget>) {
    super();
    this.budget = {
      ...DEFAULT_RUN_BUDGET,
      ...(customBudget ?? {})
    };
    this.startTime = Date.now();
  }

  public getBudget(): RunBudget {
    return { ...this.budget };
  }

  public getUsage(): RunBudgetUsage {
    return {
      elapsedMs: Date.now() - this.startTime,
      toolCalls: this.toolCallCount,
      tokens: this.tokenCount,
      childAgents: this.childAgentCount,
      filesMutated: this.mutatedFiles.size
    };
  }

  public recordToolCall(count = 1): void {
    this.toolCallCount += count;
    this.assertBudget();
  }

  public recordTokens(count: number): void {
    if (count > 0) {
      this.tokenCount += count;
      this.assertBudget();
    }
  }

  public recordChildAgent(count = 1): void {
    this.childAgentCount += count;
    this.assertBudget();
  }

  public recordFileMutation(filePath: string): void {
    this.mutatedFiles.add(filePath);
    this.assertBudget();
  }

  public checkViolation(): RunBudgetViolation | null {
    const usage = this.getUsage();

    if (usage.elapsedMs > this.budget.maxDurationMs) {
      return {
        dimension: 'maxDurationMs',
        limit: this.budget.maxDurationMs,
        actual: usage.elapsedMs,
        message: `Run exceeded maximum duration limit of ${this.budget.maxDurationMs}ms (current: ${usage.elapsedMs}ms).`
      };
    }

    if (usage.toolCalls > this.budget.maxToolCalls) {
      return {
        dimension: 'maxToolCalls',
        limit: this.budget.maxToolCalls,
        actual: usage.toolCalls,
        message: `Run exceeded maximum tool calls limit of ${this.budget.maxToolCalls} (current: ${usage.toolCalls}).`
      };
    }

    if (usage.tokens > this.budget.maxTokens) {
      return {
        dimension: 'maxTokens',
        limit: this.budget.maxTokens,
        actual: usage.tokens,
        message: `Run exceeded maximum token budget of ${this.budget.maxTokens} (current: ${usage.tokens}).`
      };
    }

    if (usage.childAgents > this.budget.maxChildAgents) {
      return {
        dimension: 'maxChildAgents',
        limit: this.budget.maxChildAgents,
        actual: usage.childAgents,
        message: `Run exceeded maximum child agent limit of ${this.budget.maxChildAgents} (current: ${usage.childAgents}).`
      };
    }

    if (usage.filesMutated > this.budget.maxFilesMutated) {
      return {
        dimension: 'maxFilesMutated',
        limit: this.budget.maxFilesMutated,
        actual: usage.filesMutated,
        message: `Run exceeded maximum file mutation limit of ${this.budget.maxFilesMutated} files (current: ${usage.filesMutated}).`
      };
    }

    return null;
  }

  public assertBudget(): void {
    const violation = this.checkViolation();
    if (violation) {
      this.emit('budget_violation', violation);
      throw new Error(`Budget violation: ${violation.message}`);
    }
  }
}
