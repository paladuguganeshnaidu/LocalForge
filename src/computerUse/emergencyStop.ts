export interface EmergencyStopConfig {
  maxActionsPerRun?: number;
  maxRuntimeMs?: number;
  maxConsecutiveFailures?: number;
}

export class EmergencyStop {
  private stopped = false;
  private stopReason = '';
  private actionCount = 0;
  private consecutiveFailures = 0;
  private readonly startedAt = Date.now();
  private readonly maxActions: number;
  private readonly maxRuntimeMs: number;
  private readonly maxFailures: number;

  constructor(config: EmergencyStopConfig = {}) {
    this.maxActions = config.maxActionsPerRun ?? 100;
    this.maxRuntimeMs = config.maxRuntimeMs ?? 15 * 60 * 1000; // 15 minutes
    this.maxFailures = config.maxConsecutiveFailures ?? 5;
  }

  public trigger(reason: string): void {
    this.stopped = true;
    this.stopReason = reason;
  }

  public isTriggered(): boolean {
    return this.stopped;
  }

  public getStopReason(): string {
    return this.stopReason;
  }

  public reset(): void {
    this.stopped = false;
    this.stopReason = '';
    this.actionCount = 0;
    this.consecutiveFailures = 0;
  }

  public recordAction(): void {
    this.assertNotStopped();
    this.actionCount += 1;
    if (this.actionCount > this.maxActions) {
      this.trigger(`Emergency stop: Exceeded maximum allowed actions limit (${this.maxActions}).`);
      throw new Error(this.stopReason);
    }
    const elapsed = Date.now() - this.startedAt;
    if (elapsed > this.maxRuntimeMs) {
      this.trigger(`Emergency stop: Exceeded maximum allowed runtime limit (${this.maxRuntimeMs}ms).`);
      throw new Error(this.stopReason);
    }
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  public recordFailure(error: string): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.maxFailures) {
      this.trigger(`Emergency stop: Triggered after ${this.consecutiveFailures} consecutive automation failures: ${error}`);
      throw new Error(this.stopReason);
    }
  }

  public assertNotStopped(): void {
    if (this.stopped) {
      throw new Error(`ComputerUse automation halted by EmergencyStop: ${this.stopReason}`);
    }
  }

  public getStats(): { actionCount: number; consecutiveFailures: number; elapsedMs: number; isStopped: boolean } {
    return {
      actionCount: this.actionCount,
      consecutiveFailures: this.consecutiveFailures,
      elapsedMs: Date.now() - this.startedAt,
      isStopped: this.stopped
    };
  }
}
