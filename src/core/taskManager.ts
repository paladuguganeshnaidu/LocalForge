import * as vscode from 'vscode';
import { AgentMode, AgentStatus } from '../agent/agentLoop';

const TASKS_STORAGE_KEY = 'localforge.workspaceTasks';

export interface TaskRecord {
  id: string;
  task: string;
  mode: AgentMode;
  model: string;
  status: AgentStatus;
  startedAt: number;
  completedAt?: number;
  filesModified: string[];
  validationCommand?: string;
  validationPassed?: boolean;
  validationSummary?: string;
  finalSummary?: string;
}

export class TaskManager {
  constructor(private readonly workspaceState: vscode.Memento) {}

  public getTasks(): TaskRecord[] {
    return this.workspaceState.get<TaskRecord[]>(TASKS_STORAGE_KEY, []);
  }

  public getLastTask(): TaskRecord | undefined {
    const tasks = this.getTasks();
    return tasks[0];
  }

  public async recordTaskStart(
    task: string,
    mode: AgentMode,
    model: string
  ): Promise<TaskRecord> {
    const record: TaskRecord = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      task,
      mode,
      model,
      status: 'planning',
      startedAt: Date.now(),
      filesModified: []
    };

    const tasks = [record, ...this.getTasks().slice(0, 19)];
    await this.workspaceState.update(TASKS_STORAGE_KEY, tasks);
    return record;
  }

  public async recordTaskCompletion(
    taskId: string,
    status: AgentStatus,
    filesModified: string[],
    finalSummary?: string,
    validation?: { command?: string; passed?: boolean; summary?: string }
  ): Promise<void> {
    const tasks = this.getTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = status;
    task.completedAt = Date.now();
    task.filesModified = Array.from(new Set([...task.filesModified, ...filesModified]));
    task.finalSummary = finalSummary;
    if (validation) {
      task.validationCommand = validation.command;
      task.validationPassed = validation.passed;
      task.validationSummary = validation.summary;
    }

    await this.workspaceState.update(TASKS_STORAGE_KEY, tasks);
  }
}
