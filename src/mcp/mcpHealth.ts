import { McpClient } from './mcpClient';

export type McpServerHealthState = 'healthy' | 'degraded' | 'failed' | 'disabled';

export interface McpServerStats {
  serverId: string;
  state: McpServerHealthState;
  consecutiveFailures: number;
  totalCalls: number;
  totalErrors: number;
  lastPingTime?: number;
  lastErrorTime?: number;
  lastErrorMessage?: string;
}

export class McpHealthMonitor {
  private readonly stats = new Map<string, McpServerStats>();
  private readonly failureThreshold: number;

  constructor(failureThreshold = 3) {
    this.failureThreshold = failureThreshold;
  }

  public registerServer(serverId: string): McpServerStats {
    let stat = this.stats.get(serverId);
    if (!stat) {
      stat = {
        serverId,
        state: 'healthy',
        consecutiveFailures: 0,
        totalCalls: 0,
        totalErrors: 0
      };
      this.stats.set(serverId, stat);
    }
    return stat;
  }

  public recordSuccess(serverId: string): void {
    const stat = this.registerServer(serverId);
    stat.totalCalls++;
    stat.consecutiveFailures = 0;
    if (stat.state === 'degraded' || stat.state === 'failed') {
      stat.state = 'healthy';
    }
  }

  public recordFailure(serverId: string, error: Error): void {
    const stat = this.registerServer(serverId);
    stat.totalCalls++;
    stat.totalErrors++;
    stat.consecutiveFailures++;
    stat.lastErrorTime = Date.now();
    stat.lastErrorMessage = error.message;

    if (stat.consecutiveFailures >= this.failureThreshold) {
      stat.state = 'failed';
    } else {
      stat.state = 'degraded';
    }
  }

  public isAvailable(serverId: string): boolean {
    const stat = this.stats.get(serverId);
    if (!stat) return true;
    return stat.state !== 'failed' && stat.state !== 'disabled';
  }

  public resetCircuit(serverId: string): void {
    const stat = this.registerServer(serverId);
    stat.consecutiveFailures = 0;
    stat.state = 'healthy';
  }

  public getStats(serverId: string): McpServerStats | undefined {
    return this.stats.get(serverId);
  }

  public getAllStats(): McpServerStats[] {
    return Array.from(this.stats.values());
  }
}
