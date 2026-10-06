import { AgentRole, AgentLifecycleEvent } from './types';
import { AgentError } from './errors';

export interface RunningAgentInstance {
  agentId: string;
  role: AgentRole;
  taskId: string;
  controller: AbortController;
  startedAt: number;
  detachParent?: () => void;
}

export class AgentPool {
  private activeAgents = new Map<string, RunningAgentInstance>();
  private readonly maxConcurrency: number;

  constructor(maxConcurrency: number = 4) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 16) throw new Error('Subagent concurrency must be an integer from 1 to 16.');
    this.maxConcurrency = maxConcurrency;
  }

  public getCapacity(): number {
    return this.maxConcurrency;
  }

  public canAcquire(): boolean {
    return this.activeAgents.size < this.maxConcurrency;
  }

  public getAvailableSlots(): number {
    return Math.max(0, this.maxConcurrency - this.activeAgents.size);
  }

  public acquire(agentId: string, role: AgentRole, taskId: string, parentSignal?: AbortSignal): AbortController {
    if (this.activeAgents.has(agentId)) throw new Error(`Subagent ${agentId} is already running.`);
    if (this.activeAgents.size >= this.maxConcurrency) {
      throw new AgentError({
        message: `Agent pool capacity exceeded (max ${this.maxConcurrency} concurrent agents).`,
        code: 'AGENT_POOL_EXHAUSTED'
      });
    }

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);

    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener('abort', abortFromParent, { once: true });
      }
    }

    this.activeAgents.set(agentId, {
      agentId,
      role,
      taskId,
      controller,
      startedAt: Date.now(),
      detachParent: parentSignal ? () => parentSignal.removeEventListener('abort', abortFromParent) : undefined
    });

    return controller;
  }

  public release(agentId: string): void {
    this.activeAgents.get(agentId)?.detachParent?.();
    this.activeAgents.delete(agentId);
  }

  public cancel(agentId: string): boolean {
    const inst = this.activeAgents.get(agentId);
    if (inst) {
      inst.controller.abort();
      return true;
    }
    return false;
  }

  public cancelAll(): void {
    for (const inst of this.activeAgents.values()) {
      inst.controller.abort();
    }
  }

  public getActiveCount(): number {
    return this.activeAgents.size;
  }

  public getActiveInstances(): RunningAgentInstance[] {
    return Array.from(this.activeAgents.values());
  }
}
