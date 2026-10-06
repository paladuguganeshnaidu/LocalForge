import { EventEmitter } from 'events';
import { McpStdioTransport } from './mcpTransport';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpServerConfig,
  McpToolCallResult,
  McpToolDefinition
} from './types';

export class McpClient extends EventEmitter {
  private transport: McpStdioTransport;
  private messageCounter = 1;
  private readonly pendingRequests = new Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private isInitialized = false;

  constructor(public readonly config: McpServerConfig) {
    super();
    this.transport = new McpStdioTransport(config);
    this.setupTransportHandlers();
  }

  private setupTransportHandlers(): void {
    this.transport.on('message', (response: JsonRpcResponse) => {
      const pending = this.pendingRequests.get(response.id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(`MCP error ${response.error.code}: ${response.error.message}`));
      } else {
        pending.resolve(response.result);
      }
    });

    this.transport.on('error', (err) => {
      this.emit('error', err);
    });

    this.transport.on('close', (event) => {
      // Reject any pending requests
      for (const [id, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`MCP transport closed while awaiting response for request ${id}`));
      }
      this.pendingRequests.clear();
      this.isInitialized = false;
      this.emit('close', event);
    });
  }

  public async connect(): Promise<void> {
    if (this.isInitialized) return;

    this.transport.start();

    // 1. Send initialize
    const initResult = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'TuxNest',
        version: '2.0.0'
      }
    })) as Record<string, unknown>;

    // 2. Send initialized notification
    try {
      this.transport.send({
        jsonrpc: '2.0',
        id: 0,
        method: 'notifications/initialized'
      });
    } catch {
      // Notification is fire-and-forget
    }

    this.isInitialized = true;
    this.emit('connected', initResult);
  }

  public async listTools(): Promise<McpToolDefinition[]> {
    if (!this.isInitialized) {
      await this.connect();
    }

    const res = (await this.request('tools/list', {})) as { tools?: McpToolDefinition[] };
    return res.tools ?? [];
  }

  public async callTool(
    name: string,
    toolArgs: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    if (!this.isInitialized) {
      await this.connect();
    }

    if (signal?.aborted) {
      throw new Error(`MCP tool call to "${name}" was aborted before execution.`);
    }

    const res = (await this.request(
      'tools/call',
      {
        name,
        arguments: toolArgs
      },
      this.config.timeoutMs ?? 30000,
      signal
    )) as McpToolCallResult;

    return res;
  }

  public async ping(): Promise<boolean> {
    try {
      await this.request('ping', {}, 5000);
      return true;
    } catch {
      return false;
    }
  }

  public request(
    method: string,
    params?: unknown,
    timeoutMs = 30000,
    signal?: AbortSignal
  ): Promise<unknown> {
    const id = this.messageCounter++;
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new Error(`Request ${method} aborted`));
      }

      let abortHandler: (() => void) | undefined = undefined;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        reject(new Error(`MCP request "${method}" (id: ${id}) timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      if (signal) {
        abortHandler = () => {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request "${method}" (id: ${id}) was aborted.`));
        };
        signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.pendingRequests.set(id, {
        resolve: (val) => {
          if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
          resolve(val);
        },
        reject: (err) => {
          if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
          reject(err);
        },
        timer
      });

      try {
        this.transport.send(req);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  public close(): void {
    this.transport.close();
    this.isInitialized = false;
  }
}
