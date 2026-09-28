import { spawn, ChildProcess } from 'node:child_process';
import * as vscode from 'vscode';

export interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  isBackground: boolean;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  startTime: number;
  endTime?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
}

export class TerminalManager {
  private processes = new Map<string, ManagedProcess>();
  private activeChildren = new Map<string, ChildProcess>();

  public runCommand(
    command: string,
    cwd: string,
    isBackground = false,
    timeoutMs = 60000
  ): Promise<ManagedProcess> {
    const id = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: ManagedProcess = {
      id,
      command,
      cwd,
      isBackground,
      status: 'running',
      startTime: Date.now(),
      stdout: '',
      stderr: ''
    };

    this.processes.set(id, record);

    return new Promise((resolve) => {
      // Use shell for command execution
      const child = spawn(command, {
        cwd,
        shell: true,
        timeout: isBackground ? undefined : timeoutMs
      });

      this.activeChildren.set(id, child);

      child.stdout?.on('data', (data: Buffer | string) => {
        record.stdout = (record.stdout + data.toString()).slice(-20000);
      });

      child.stderr?.on('data', (data: Buffer | string) => {
        record.stderr = (record.stderr + data.toString()).slice(-10000);
      });

      child.on('close', (code) => {
        this.activeChildren.delete(id);
        record.endTime = Date.now();
        record.exitCode = code ?? (record.status === 'stopped' ? 130 : 0);
        record.status = record.status === 'stopped' ? 'stopped' : code === 0 ? 'completed' : 'failed';
        resolve(record);
      });

      child.on('error', (err) => {
        this.activeChildren.delete(id);
        record.endTime = Date.now();
        record.status = 'failed';
        record.stderr += `\nProcess error: ${err.message}`;
        resolve(record);
      });

      if (isBackground) {
        // Resolve immediately so caller doesn't wait indefinitely for long-running servers
        resolve(record);
      }
    });
  }

  public stopProcess(id: string): boolean {
    const child = this.activeChildren.get(id);
    const proc = this.processes.get(id);
    if (proc) {
      proc.status = 'stopped';
    }
    if (child) {
      child.kill('SIGTERM');
      this.activeChildren.delete(id);
      return true;
    }
    return false;
  }

  public async restartProcess(id: string): Promise<ManagedProcess | undefined> {
    const proc = this.processes.get(id);
    if (!proc) return undefined;
    this.stopProcess(id);
    return this.runCommand(proc.command, proc.cwd, proc.isBackground);
  }

  public getRunningProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter((p) => p.status === 'running');
  }

  public getAllProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).slice(-20);
  }
}
