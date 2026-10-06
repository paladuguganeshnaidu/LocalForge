import * as vscode from 'vscode';
import { SerializedTaskGraph, TaskGraph } from './taskGraph';
import { ProductMode } from './types';
import { StorageMigrationManager } from '../../migrations/storageMigration';

export const MODERN_CHECKPOINT_KEY = 'tuxnest.agent.checkpoint';
export const LEGACY_CHECKPOINT_KEY = 'localforge.agent.checkpoint';

export interface CheckpointData {
  schemaVersion: number;
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

  public async saveCheckpoint(data: Omit<CheckpointData, 'schemaVersion'>): Promise<void> {
    const payload: CheckpointData = {
      schemaVersion: 2,
      ...data
    };
    await this.storage.update(MODERN_CHECKPOINT_KEY, payload);
  }

  public getCheckpoint(): CheckpointData | undefined {
    // 1. Try modern key
    let raw = this.storage.get<unknown>(MODERN_CHECKPOINT_KEY);

    // 2. If absent, fallback to legacy key
    if (!raw) {
      raw = this.storage.get<unknown>(LEGACY_CHECKPOINT_KEY);
    }

    if (!raw) return undefined;

    try {
      const unwrapped = StorageMigrationManager.unwrapVersioned<CheckpointData>(raw);
      return unwrapped.data;
    } catch {
      // If corrupted, fail safely without throwing unhandled exceptions
      return undefined;
    }
  }

  public async clearCheckpoint(): Promise<void> {
    await this.storage.update(MODERN_CHECKPOINT_KEY, undefined);
    await this.storage.update(LEGACY_CHECKPOINT_KEY, undefined);
  }

  public hasIncompleteCheckpoint(): boolean {
    const cp = this.getCheckpoint();
    return Boolean(cp && (cp.status === 'running' || cp.status === 'interrupted'));
  }

  public async markInterrupted(): Promise<void> {
    const cp = this.getCheckpoint();
    if (cp && cp.status === 'running') {
      cp.status = 'interrupted';
      await this.saveCheckpoint(cp);
    }
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

  public restoreCheckpoint(): { graph: TaskGraph; runId: string; task: string; mode: ProductMode; filesModified: string[] } | undefined {
    const cp = this.getCheckpoint();
    if (!cp || !cp.graph) return undefined;
    try {
      const graph = TaskGraph.deserialize(cp.graph);
      return {
        graph,
        runId: cp.runId,
        task: cp.task,
        mode: cp.mode,
        filesModified: cp.filesModified ?? []
      };
    } catch {
      return undefined;
    }
  }
}

