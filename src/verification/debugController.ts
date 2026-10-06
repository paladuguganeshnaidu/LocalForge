import * as crypto from 'crypto';

export interface DebugAttempt {
  signature: string;
  hypothesis: string;
  appliedFix: string;
  timestamp: number;
}

export class DebugController {
  private readonly attempts: DebugAttempt[] = [];
  private readonly signatureCounts = new Map<string, number>();

  public computeFailureSignature(errorMessage: string, stack?: string): string {
    // Normalize error text (strip line numbers, timestamps, memory addresses)
    const normalized = (errorMessage + (stack ? `\n${stack.split('\n')[0]}` : ''))
      .replace(/:\d+:\d+/g, '')
      .replace(/0x[0-9a-fA-F]+/g, '')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '')
      .trim();

    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  }

  public recordAttempt(
    signature: string,
    hypothesis: string,
    appliedFix: string
  ): { count: number; loopDetected: boolean; recommendation?: string } {
    const count = (this.signatureCounts.get(signature) ?? 0) + 1;
    this.signatureCounts.set(signature, count);

    this.attempts.push({
      signature,
      hypothesis,
      appliedFix,
      timestamp: Date.now()
    });

    if (count >= 3) {
      return {
        count,
        loopDetected: true,
        recommendation: `Repeated failure loop detected: identical failure signature "${signature}" encountered ${count} times without progress. Abort and formulate an alternative architectural strategy.`
      };
    }

    return {
      count,
      loopDetected: false
    };
  }

  public getHistory(): readonly DebugAttempt[] {
    return [...this.attempts];
  }

  public reset(): void {
    this.attempts.length = 0;
    this.signatureCounts.clear();
  }
}
