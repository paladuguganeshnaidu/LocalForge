import { spawn, ChildProcess } from 'node:child_process';
import { classifyCommand } from '../security/commandPolicy';
import { redactString } from '../security/secretRedactor';
import * as vscode from 'vscode';

export type ProcessStatus = 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'timed_out' | 'cancelled';

export interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  isBackground: boolean;
  status: ProcessStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  exitCode?: number;
  stdout: string;
  stderr: string;
  processId?: number;
}

export class TerminalManager {
  private processes = new Map<string, ManagedProcess>();
  private activeChildren = new Map<string, ChildProcess>();

  private killChildTree(child: ChildProcess): void {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }

  public runCommand(
    command: string,
    cwd: string,
    isBackground = false,
    timeoutMs = 60000,
    signal?: AbortSignal
  ): Promise<ManagedProcess> {
    const id = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: ManagedProcess = {
      id,
      command,
      cwd,
      isBackground,
      status: 'queued',
      startTime: Date.now(),
      stdout: '',
      stderr: ''
    };

    this.processes.set(id, record);

    const commandDecision = classifyCommand(command);
    if (commandDecision.risk === 'DESTRUCTIVE') throw new Error(commandDecision.reason || 'Destructive command blocked by CommandPolicy.');

    if (signal?.aborted) {
      record.status = 'cancelled';
      record.endTime = Date.now();
      record.duration = 0;
      record.stderr = 'Command aborted before execution.';
      return Promise.resolve(record);
    }

    return new Promise((resolve) => {
      record.status = 'running';
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;

      const abortHandler = () => {
        record.status = 'stopped';
        record.endTime = Date.now();
        record.duration = record.endTime - record.startTime;
        record.stderr += '\nCommand cancelled by user.';
        const child = this.activeChildren.get(id);
        if (child) {
          this.killChildTree(child);
        }
        resolve(record);
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      if (!isBackground && timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          record.status = 'timed_out';
          record.endTime = Date.now();
          record.duration = record.endTime - record.startTime;
          record.stderr += `\nCommand timed out after ${timeoutMs}ms.`;
          const child = this.activeChildren.get(id);
          if (child) {
            this.killChildTree(child);
          }
          resolve(record);
        }, timeoutMs);
      }

      const child = spawn(command, {
        cwd,
        shell: true,
        detached: process.platform !== 'win32'
      });

      record.processId = child.pid;
      this.activeChildren.set(id, child);

      child.stdout?.on('data', (data: Buffer | string) => {
        record.stdout = redactString((record.stdout + data.toString()).slice(-20000));
      });

      child.stderr?.on('data', (data: Buffer | string) => {
        record.stderr = redactString((record.stderr + data.toString()).slice(-10000));
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abortHandler);
        this.activeChildren.delete(id);
        if (!timedOut && record.status !== 'stopped') {
          record.endTime = Date.now();
          record.duration = record.endTime - record.startTime;
          record.exitCode = code ?? 0;
          record.status = code === 0 ? 'completed' : 'failed';
          resolve(record);
        }
      });

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abortHandler);
        this.activeChildren.delete(id);
        if (!timedOut && record.status !== 'stopped') {
          record.endTime = Date.now();
          record.duration = record.endTime - record.startTime;
          record.status = 'failed';
          record.stderr = redactString(record.stderr + '\nProcess error: ' + err.message);
          resolve(record);
        }
      });

      if (isBackground) {
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
      this.killChildTree(child);
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
