import * as vscode from 'vscode';
import { SerializedTaskGraph, TaskGraph } from './taskGraph';
import { ProductMode } from './types';

export const CHECKPOINT_STORAGE_KEY = 'localforge.agent.checkpoint';

export interface CheckpointData {
  runId: string;
  task: string;
  mode: ProductMode;
  graph: SerializedTaskGraph;
  filesModified: string[];
  timestamp: number;
  status: 'running' | 'interrupted' | 'completed' | 'failed';
}

export class CheckpointManager {
  constructor(private readonly storage: vscode.Memento) {}

  public async saveCheckpoint(data: CheckpointData): Promise<void> {
    await this.storage.update(CHECKPOINT_STORAGE_KEY, data);
  }

  public getCheckpoint(): CheckpointData | undefined {
    return this.storage.get<CheckpointData>(CHECKPOINT_STORAGE_KEY);
  }

  public async clearCheckpoint(): Promise<void> {
    await this.storage.update(CHECKPOINT_STORAGE_KEY, undefined);
  }

  public hasIncompleteCheckpoint(): boolean {
    const cp = this.getCheckpoint();
    return Boolean(cp && (cp.status === 'running' || cp.status === 'interrupted'));
  }

  public restoreTaskGraph(): TaskGraph | undefined {
    const cp = this.getCheckpoint();
    if (!cp || !cp.graph) return undefined;
    try {
      return TaskGraph.deserialize(cp.graph);
    } catch {
      return undefined;
    }
  }
}
