import { AgentRole, AgentLifecycleEvent } from './types';
import { AgentError } from './errors';

export interface RunningAgentInstance {
  agentId: string;
  role: AgentRole;
  taskId: string;
  controller: AbortController;
  startedAt: number;
}

export class AgentPool {
  private activeAgents = new Map<string, RunningAgentInstance>();
  private readonly maxConcurrency: number;

  constructor(maxConcurrency: number = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  public canAcquire(): boolean {
    return this.activeAgents.size < this.maxConcurrency;
  }

  public acquire(agentId: string, role: AgentRole, taskId: string, parentSignal?: AbortSignal): AbortController {
    if (this.activeAgents.size >= this.maxConcurrency) {
      throw new AgentError({
        message: `Agent pool capacity exceeded (max ${this.maxConcurrency} concurrent agents).`,
        code: 'AGENT_POOL_EXHAUSTED'
      });
    }

    const controller = new AbortController();

    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    this.activeAgents.set(agentId, {
      agentId,
      role,
      taskId,
      controller,
      startedAt: Date.now()
    });

    return controller;
  }

  public release(agentId: string): void {
    this.activeAgents.delete(agentId);
  }

  public cancel(agentId: string): boolean {
    const inst = this.activeAgents.get(agentId);
    if (inst) {
      inst.controller.abort();
      this.activeAgents.delete(agentId);
      return true;
    }
    return false;
  }

  public cancelAll(): void {
    for (const inst of this.activeAgents.values()) {
      inst.controller.abort();
    }
    this.activeAgents.clear();
  }

  public getActiveCount(): number {
    return this.activeAgents.size;
  }

  public getActiveInstances(): RunningAgentInstance[] {
    return Array.from(this.activeAgents.values());
  }
}
