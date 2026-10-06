import * as child_process from 'child_process';
import { EventEmitter } from 'events';
import { JsonRpcRequest, JsonRpcResponse, McpServerConfig } from './types';

export class McpStdioTransport extends EventEmitter {
  private process?: child_process.ChildProcess;
  private buffer = '';
  private isClosed = false;

  constructor(private readonly config: McpServerConfig) {
    super();
  }

  public start(): void {
    if (this.process) return;

    this.process = child_process.spawn(this.config.command, this.config.args ?? [], {
      env: {
        ...process.env,
        ...(this.config.env ?? {})
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          this.emit('message', parsed);
        } catch (err) {
          this.emit('error', new Error(`Failed to parse MCP JSON-RPC message: ${trimmed}`));
        }
      }
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString('utf-8'));
    });

    this.process.on('error', (err) => {
      this.emit('error', err);
    });

    this.process.on('close', (code, signal) => {
      this.isClosed = true;
      this.emit('close', { code, signal });
    });
  }

  public send(request: JsonRpcRequest): void {
    if (!this.process || this.isClosed || !this.process.stdin?.writable) {
      throw new Error(`Cannot send message: MCP server "${this.config.name}" transport is not active.`);
    }

    const payload = JSON.stringify(request) + '\n';
    this.process.stdin.write(payload);
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;

    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill();
      } catch {
        // Process may already have terminated
      }
      this.process = undefined;
    }
  }

  public isRunning(): boolean {
    return !!this.process && !this.isClosed;
  }
}
