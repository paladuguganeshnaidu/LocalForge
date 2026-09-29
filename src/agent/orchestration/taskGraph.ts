import { AgentRole, AgentResult } from './types';
import { AgentError } from './errors';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface TaskGraphNode {
  id: string;
  title: string;
  description: string;
  role: AgentRole;
  dependencies: string[];
  targetFiles: string[];
  status: TaskNodeStatus;
  priority: TaskPriority;
  retries: number;
  maxRetries: number;
  result?: AgentResult;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface SerializedTaskGraph {
  nodes: TaskGraphNode[];
}

export class TaskGraph {
  private nodes = new Map<string, TaskGraphNode>();

  public addNode(node: Omit<TaskGraphNode, 'status' | 'retries'> & { status?: TaskNodeStatus; retries?: number }): void {
    if (this.nodes.has(node.id)) {
      throw new AgentError({
        message: `Task node with id "${node.id}" already exists in TaskGraph.`,
        code: 'DUPLICATE_TASK_NODE'
      });
    }

    this.nodes.set(node.id, {
      ...node,
      status: node.status ?? 'pending',
      retries: node.retries ?? 0,
      maxRetries: node.maxRetries ?? 2
    });

    this.recomputeStatus();
  }

  public getNode(id: string): TaskGraphNode | undefined {
    return this.nodes.get(id);
  }

  public getAllNodes(): TaskGraphNode[] {
    return Array.from(this.nodes.values());
  }

  public addDependency(dependentId: string, prerequisiteId: string): void {
    const node = this.nodes.get(dependentId);
    if (!node) {
      throw new AgentError({ message: `Node "${dependentId}" not found.`, code: 'TASK_NOT_FOUND' });
    }
    if (!this.nodes.has(prerequisiteId)) {
      throw new AgentError({ message: `Prerequisite "${prerequisiteId}" not found.`, code: 'TASK_NOT_FOUND' });
    }
    const alreadyHad = node.dependencies.includes(prerequisiteId);
    if (!alreadyHad) {
      node.dependencies.push(prerequisiteId);
    }
    try {
      this.detectCycles();
    } catch (err) {
      if (!alreadyHad) {
        const idx = node.dependencies.indexOf(prerequisiteId);
        if (idx !== -1) node.dependencies.splice(idx, 1);
      }
      throw err;
    }
    this.recomputeStatus();
  }

  public getReadyTasks(): TaskGraphNode[] {
    const runningFiles = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.status === 'running') {
        for (const file of n.targetFiles) {
          runningFiles.add(file.toLowerCase());
        }
      }
    }

    const ready: TaskGraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.status !== 'ready' && node.status !== 'pending') continue;

      const allDepsMet = node.dependencies.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep && dep.status === 'completed';
      });

      if (!allDepsMet) continue;

      // File Conflict Detection: ensure no overlapping target files with currently running tasks
      const hasConflict = node.targetFiles.some((f) => runningFiles.has(f.toLowerCase()));
      if (!hasConflict) {
        node.status = 'ready';
        ready.push(node);
      }
    }

    // Sort ready tasks by priority
    const priorityWeights: Record<TaskPriority, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1
    };

    return ready.sort((a, b) => priorityWeights[b.priority] - priorityWeights[a.priority]);
  }

  public markRunning(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'running';
    node.startedAt = Date.now();
  }

  public markCompleted(id: string, result: AgentResult): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'completed';
    node.result = result;
    node.completedAt = Date.now();
    this.recomputeStatus();
  }

  public markFailed(id: string, error: string): boolean {
    const node = this.nodes.get(id);
    if (!node) return false;

    if (node.retries < node.maxRetries) {
      node.retries += 1;
      node.status = 'pending';
      this.recomputeStatus();
      return true; // will retry
    }

    node.status = 'failed';
    node.error = error;
    node.completedAt = Date.now();
    this.propagateFailure(id);
    this.recomputeStatus();
    return false; // failed permanently
  }

  public markCancelled(id: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    node.status = 'cancelled';
    node.completedAt = Date.now();
    this.propagateFailure(id, 'cancelled');
    this.recomputeStatus();
  }

  public cancelAll(): void {
    for (const node of this.nodes.values()) {
      if (node.status === 'pending' || node.status === 'ready' || node.status === 'running') {
        node.status = 'cancelled';
        node.completedAt = Date.now();
      }
    }
  }

  private propagateFailure(failedId: string, targetStatus: 'blocked' | 'cancelled' = 'blocked'): void {
    for (const node of this.nodes.values()) {
      if (node.dependencies.includes(failedId) && (node.status === 'pending' || node.status === 'ready')) {
        node.status = targetStatus;
        this.propagateFailure(node.id, targetStatus);
      }
    }
  }

  private recomputeStatus(): void {
    for (const node of this.nodes.values()) {
      if (node.status === 'completed' || node.status === 'failed' || node.status === 'cancelled' || node.status === 'running') {
        continue;
      }

      let blocked = false;
      let allDepsCompleted = true;

      for (const depId of node.dependencies) {
        const dep = this.nodes.get(depId);
        if (!dep || dep.status === 'failed' || dep.status === 'cancelled' || dep.status === 'blocked') {
          blocked = true;
          break;
        }
        if (dep.status !== 'completed') {
          allDepsCompleted = false;
        }
      }

      if (blocked) {
        node.status = 'blocked';
      } else if (allDepsCompleted) {
        node.status = 'ready';
      } else {
        node.status = 'pending';
      }
    }
  }

  public detectCycles(): void {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const checkCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (!visited.has(depId) && checkCycle(depId)) {
            return true;
          } else if (recStack.has(depId)) {
            return true;
          }
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const id of this.nodes.keys()) {
      if (!visited.has(id)) {
        if (checkCycle(id)) {
          throw new AgentError({
            message: `Cyclic dependency detected in TaskGraph involving task "${id}".`,
            code: 'TASK_GRAPH_CYCLE'
          });
        }
      }
    }
  }

  public getTopologicalOrder(): TaskGraphNode[] {
    this.detectCycles();
    const visited = new Set<string>();
    const order: TaskGraphNode[] = [];

    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = this.nodes.get(nodeId);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
        order.push(node);
      }
    };

    for (const id of this.nodes.keys()) {
      visit(id);
    }

    return order;
  }

  public isComplete(): boolean {
    const nodes = Array.from(this.nodes.values());
    if (nodes.length === 0) return true;
    return nodes.every((n) => n.status === 'completed');
  }

  public isFinished(): boolean {
    const nodes = Array.from(this.nodes.values());
    if (nodes.length === 0) return true;
    return nodes.every((n) => n.status === 'completed' || n.status === 'failed' || n.status === 'cancelled' || n.status === 'blocked');
  }

  public hasFailures(): boolean {
    return Array.from(this.nodes.values()).some((n) => n.status === 'failed' || n.status === 'blocked');
  }

  public serialize(): SerializedTaskGraph {
    return {
      nodes: Array.from(this.nodes.values())
    };
  }

  public static deserialize(data: SerializedTaskGraph): TaskGraph {
    const graph = new TaskGraph();
    for (const node of data.nodes) {
      graph.nodes.set(node.id, { ...node });
    }
    graph.detectCycles();
    graph.recomputeStatus();
    return graph;
  }
}
