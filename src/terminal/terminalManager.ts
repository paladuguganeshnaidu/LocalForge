import { spawn, ChildProcess } from 'node:child_process';

export type ProcessStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped' | 'timed_out';

export interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  shell: string;
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
  private stopReasons = new Map<string, 'stopped' | 'timed_out'>();
  private completions = new Map<string, Promise<void>>();

  private killChildTree(child: ChildProcess): void {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        killer.on('error', () => child.kill('SIGKILL'));
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
        const escalation = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          try { process.kill(-child.pid!, 'SIGKILL'); }
          catch { child.kill('SIGKILL'); }
        }, 1500);
        escalation.unref();
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
  }

  private requestStop(id: string, reason: 'stopped' | 'timed_out'): boolean {
    const child = this.activeChildren.get(id);
    const record = this.processes.get(id);
    if (!child || !record) return false;
    if (record.status === 'stopping') return true;
    this.stopReasons.set(id, reason);
    record.status = 'stopping';
    this.killChildTree(child);
    return true;
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
      shell: process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh',
      isBackground,
      status: 'queued',
      startTime: Date.now(),
      stdout: '',
      stderr: ''
    };

    this.processes.set(id, record);

    if (signal?.aborted) {
      record.status = 'stopped';
      record.endTime = Date.now();
      record.duration = 0;
      record.stderr = 'Command aborted before execution.';
      return Promise.resolve(record);
    }

    let finishCompletion: () => void = () => {};
    this.completions.set(id, new Promise((resolve) => { finishCompletion = resolve; }));
    return new Promise((resolve) => {
      record.status = 'running';
      let timer: NodeJS.Timeout | undefined;
      let finished = false;

      const abortHandler = () => {
        if (timer) clearTimeout(timer);
        record.stderr += '\nCommand cancelled by user.';
        this.requestStop(id, 'stopped');
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      if (!isBackground && timeoutMs > 0) {
        timer = setTimeout(() => {
          record.stderr += `\nCommand timed out after ${timeoutMs}ms.`;
          this.requestStop(id, 'timed_out');
        }, timeoutMs);
      }

      const child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        detached: process.platform !== 'win32'
      });

      record.processId = child.pid;
      this.activeChildren.set(id, child);

      child.stdout?.on('data', (data: Buffer | string) => {
        record.stdout = (record.stdout + data.toString()).slice(-20000);
      });

      child.stderr?.on('data', (data: Buffer | string) => {
        record.stderr = (record.stderr + data.toString()).slice(-10000);
      });

      const finish = (code: number | null, error?: Error) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', abortHandler);
        this.activeChildren.delete(id);
        record.endTime = Date.now();
        record.duration = record.endTime - record.startTime;
        record.exitCode = code ?? undefined;
        record.status = error ? 'failed' : this.stopReasons.get(id) ?? (code === 0 ? 'completed' : 'failed');
        if (error) record.stderr += `\nProcess error: ${error.message}`;
        this.stopReasons.delete(id);
        this.completions.delete(id);
        finishCompletion();
        resolve(record);
      };

      child.on('close', (code) => finish(code));
      child.on('error', (error) => finish(null, error));

      if (isBackground) {
        resolve(record);
      }
    });
  }

  public stopProcess(id: string): boolean {
    return this.requestStop(id, 'stopped');
  }

  public async restartProcess(id: string): Promise<ManagedProcess | undefined> {
    const proc = this.processes.get(id);
    if (!proc) return undefined;
    const completion = this.completions.get(id);
    this.stopProcess(id);
    if (completion) await completion;
    return this.runCommand(proc.command, proc.cwd, proc.isBackground);
  }

  public getRunningProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter((record) => record.status === 'running' || record.status === 'stopping');
  }

  public getAllProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).slice(-20);
  }
}
