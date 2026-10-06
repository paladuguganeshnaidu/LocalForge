import { spawn, ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { ShellResolver } from './shellResolver';
import { CommandTimeoutClassifier } from './commandTimeoutClassifier';
import { EnvironmentFilter } from './environmentFilter';
import { RingBuffer } from './ringBuffer';

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

export interface RunCommandOptions {
  shell?: 'auto' | 'bash' | 'powershell' | 'cmd' | string;
  inactivityTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export class TerminalManager {
  private processes = new Map<string, ManagedProcess>();
  private activeChildren = new Map<string, ChildProcess>();
  private stopReasons = new Map<string, 'stopped' | 'timed_out'>();
  private completions = new Map<string, Promise<void>>();
  private backgroundStarts = new Map<string, Promise<ManagedProcess>>();
  private treeTerminations = new Map<string, Promise<void>>();
  private terminationFailures = new Map<string, string>();

  public async startBackgroundCommand(
    command: string,
    cwd: string,
    signal?: AbortSignal,
    options?: RunCommandOptions
  ): Promise<ManagedProcess & { reused?: boolean }> {
    signal?.throwIfAborted();
    const normalizedCwd = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value);
    const key = JSON.stringify([normalizedCwd(cwd), command.trim()]);
    const pending = this.backgroundStarts.get(key);
    if (pending) {
      const record = await pending;
      signal?.throwIfAborted();
      return { ...record, reused: true };
    }
    const existing = this.getRunningProcesses().find(record =>
      record.isBackground &&
      record.command.trim() === command.trim() &&
      normalizedCwd(record.cwd) === normalizedCwd(cwd)
    );
    if (existing?.status === 'running') return { ...existing, reused: true };
    const start = (async () => {
      if (existing) { await this.completions.get(existing.id); await this.treeTerminations.get(existing.id); }
      signal?.throwIfAborted();
      const record = await this.runCommand(command, cwd, true, 0, signal, options);
      await new Promise(resolve => setTimeout(resolve, 500));
      return record;
    })();
    this.backgroundStarts.set(key, start);
    try { return { ...await start }; }
    finally { if (this.backgroundStarts.get(key) === start) this.backgroundStarts.delete(key); }
  }

  private async killChildTree(child: ChildProcess): Promise<void> {
    if (!child.pid) return;
    try {
      if (process.platform === 'win32') {
        await new Promise<void>((complete, reject) => {
          let output = '';
          const killer = spawn(
            join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'),
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
          );
          killer.stdout?.on('data', data => { output = (output + data.toString()).slice(-2000); });
          killer.stderr?.on('data', data => { output = (output + data.toString()).slice(-2000); });
          killer.on('error', error => { child.kill('SIGKILL'); reject(error); });
          killer.on('close', code => (code === 0 || /There is no running instance of the task|not found/i.test(output))
            ? complete()
            : reject(new Error(`Owned process-tree termination exited with code ${code}: ${output.trim()}`))
          );
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          try { child.kill('SIGTERM'); } catch {}
        }
        // Await process group termination deterministically
        const deadline = Date.now() + 1500;
        let isAlive = true;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 25));
          try {
            process.kill(-child.pid, 0);
          } catch {
            isAlive = false;
            break;
          }
          if (Date.now() - (deadline - 1500) > 300) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch {}
            try { child.kill('SIGKILL'); } catch {}
          }
        }
        if (isAlive) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          try { child.kill('SIGKILL'); } catch {}
        }
      }
    } catch (error) {
      try {
        child.kill('SIGKILL');
      } catch {}
      throw error;
    }
  }

  private requestStop(id: string, reason: 'stopped' | 'timed_out'): boolean {
    const child = this.activeChildren.get(id);
    const record = this.processes.get(id);
    if (!child || !record) return false;
    if (record.status === 'stopping') return true;
    this.stopReasons.set(id, reason);
    record.status = 'stopping';
    const termination = this.killChildTree(child).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.terminationFailures.set(id, message);
      record.stderr += `\nProcess-tree cleanup failed: ${message}`;
    }).finally(() => { this.treeTerminations.delete(id); });
    this.treeTerminations.set(id, termination);
    return true;
  }

  public runCommand(
    command: string,
    cwd: string,
    isBackground = false,
    timeoutMs = 60000,
    signal?: AbortSignal,
    options?: RunCommandOptions
  ): Promise<ManagedProcess> {
    const id = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const resolvedShell = ShellResolver.resolve(options?.shell, command);

    const record: ManagedProcess = {
      id,
      command,
      cwd,
      shell: resolvedShell.displayName,
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
      let finished = false;

      // Classify command and calculate adaptive maximum and streaming inactivity timeouts
      const timeoutPolicy = CommandTimeoutClassifier.classify(command, timeoutMs);
      const effectiveMaxTimeout = timeoutPolicy.maxTimeoutMs;
      const effectiveInactivityTimeout = options?.inactivityTimeoutMs ?? timeoutPolicy.inactivityTimeoutMs;

      let lastActivityAt = Date.now();
      let inactivityTimer: NodeJS.Timeout | undefined;
      let maxTimer: NodeJS.Timeout | undefined;

      const clearAllTimers = () => {
        if (inactivityTimer) {
          clearTimeout(inactivityTimer);
          inactivityTimer = undefined;
        }
        if (maxTimer) {
          clearTimeout(maxTimer);
          maxTimer = undefined;
        }
      };

      const scheduleInactivityCheck = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (effectiveInactivityTimeout <= 0 || isBackground) return;

        inactivityTimer = setTimeout(() => {
          if (record.status !== 'running' || child?.exitCode !== null || child?.signalCode !== null) return;
          const idleMs = Date.now() - lastActivityAt;
          if (idleMs >= effectiveInactivityTimeout) {
            record.stderr += `\nCommand timed out after ${effectiveInactivityTimeout}ms.`;
            this.requestStop(id, 'timed_out');
          } else {
            scheduleInactivityCheck();
          }
        }, Math.max(10, effectiveInactivityTimeout - (Date.now() - lastActivityAt)));
      };

      const abortHandler = () => {
        clearAllTimers();
        record.stderr += '\nCommand cancelled by user.';
        this.requestStop(id, 'stopped');
      };

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      if (!isBackground && effectiveMaxTimeout > 0) {
        maxTimer = setTimeout(() => {
          if (record.status !== 'running') return;
          record.stderr += `\nCommand timed out after ${effectiveMaxTimeout}ms.`;
          this.requestStop(id, 'timed_out');
        }, effectiveMaxTimeout);
      }

      if (!isBackground) {
        scheduleInactivityCheck();
      }

      let child: ChildProcess;
      const filteredEnv = EnvironmentFilter.filterEnvironment(process.env, Object.keys(options?.env || {}));
      const defaultEnv: Record<string, string> = {
        ...filteredEnv,
        CI: 'true',
        npm_config_yes: 'false'
      };
      if (options?.env) {
        for (const [k, v] of Object.entries(options.env)) {
          if (v !== undefined) defaultEnv[k] = v;
        }
      }

      if (resolvedShell.type === 'bash' || resolvedShell.type === 'powershell') {
        child = spawn(resolvedShell.executable, resolvedShell.args, {
          cwd,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: defaultEnv,
          detached: process.platform !== 'win32'
        });
      } else {
        child = spawn(command, {
          cwd,
          shell: process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : true,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: defaultEnv,
          detached: process.platform !== 'win32'
        });
      }

      record.processId = child.pid;
      this.activeChildren.set(id, child);

      const checkPrompt = () => {
        if (record.status !== 'running') return;
        const combined = record.stderr + record.stdout;
        if (/Do you want to install\s+['"]?webpack-cli['"]?\s+\(yes\/no\)/i.test(combined)) {
          record.stderr += '\nInteractive package installation cannot receive input in agent commands. Install the missing declared build tooling with explicit install_packages approval, then retry the original command.';
          this.requestStop(id, 'stopped');
        } else if (/Do you want to install\s+['"]?[\w-]+['"]?\s+\(yes\/no\)/i.test(combined)) {
          record.stderr += '\nInteractive package installation cannot receive input in agent commands. Run installation non-interactively with explicit flags.';
          this.requestStop(id, 'stopped');
        } else if (/Are you sure you want to continue\s+connecting\s+\(yes\/no(?:\/\[fingerprint\])?\)/i.test(combined)) {
          record.stderr += '\nSSH host verification prompt detected without interactive terminal.';
          this.requestStop(id, 'stopped');
        }
      };

      child.stdout?.on('data', (data: Buffer | string) => {
        lastActivityAt = Date.now();
        scheduleInactivityCheck();
        record.stdout = (record.stdout + data.toString()).slice(-20000);
        checkPrompt();
      });

      child.stderr?.on('data', (data: Buffer | string) => {
        lastActivityAt = Date.now();
        scheduleInactivityCheck();
        record.stderr = (record.stderr + data.toString()).slice(-10000);
        checkPrompt();
      });

      const finish = (code: number | null, error?: Error) => {
        if (finished) return;
        finished = true;
        clearAllTimers();
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

      child.on('exit', () => {
        clearAllTimers();
      });
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

  public async stopAllProcesses(): Promise<void> {
    for (const record of this.getRunningProcesses()) this.stopProcess(record.id);
    const pending = [...this.completions.values(), ...this.treeTerminations.values()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(pending),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Owned process cleanup did not finish within 10 seconds.')), 10000); })
      ]);
      if (this.terminationFailures.size) throw new Error(`Owned process cleanup failed: ${[...this.terminationFailures.values()].join('; ')}`);
    } finally { if (timer) clearTimeout(timer); }
  }

  public async restartProcess(id: string): Promise<ManagedProcess | undefined> {
    const proc = this.processes.get(id);
    if (!proc) return undefined;
    const completion = this.completions.get(id);
    this.stopProcess(id);
    const termination = this.treeTerminations.get(id);
    if (completion) await completion;
    if (termination) await termination;
    return this.runCommand(proc.command, proc.cwd, proc.isBackground);
  }

  public getRunningProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).filter((record) => record.status === 'running' || record.status === 'stopping');
  }

  public getAllProcesses(): ManagedProcess[] {
    return Array.from(this.processes.values()).slice(-20);
  }
}
