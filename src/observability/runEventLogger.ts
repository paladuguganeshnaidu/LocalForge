import * as fs from 'fs';
import * as path from 'path';
import { SecretClassifier } from '../policy/secretClassifier';

export type EventType =
  | 'run_start'
  | 'run_state'
  | 'tool_call'
  | 'approval'
  | 'error'
  | 'metric'
  | 'checkpoint';

export interface StructuredRunEvent {
  eventId: string;
  runId: string;
  agentId?: string;
  eventType: EventType;
  timestamp: number;
  durationMs?: number;
  details: Record<string, unknown>;
}

export class RunEventLogger {
  private readonly events: StructuredRunEvent[] = [];
  private readonly maxInMemoryEvents = 5000;

  constructor(private readonly logDir?: string) {
    if (logDir && !fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  }

  public log(event: Omit<StructuredRunEvent, 'eventId' | 'timestamp'>): StructuredRunEvent {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Redact any secrets in details
    const serialized = JSON.stringify(event.details);
    const sanitizedStr = SecretClassifier.redact(serialized);
    const sanitizedDetails = JSON.parse(sanitizedStr) as Record<string, unknown>;

    const structuredEvent: StructuredRunEvent = {
      eventId,
      timestamp: Date.now(),
      ...event,
      details: sanitizedDetails
    };

    this.events.push(structuredEvent);
    if (this.events.length > this.maxInMemoryEvents) {
      this.events.shift();
    }

    if (this.logDir) {
      try {
        const logFile = path.join(this.logDir, `run_${event.runId}.jsonl`);
        fs.appendFileSync(logFile, JSON.stringify(structuredEvent) + '\n', 'utf-8');
      } catch {
        // Best-effort file append
      }
    }

    return structuredEvent;
  }

  public getEventsForRun(runId: string): StructuredRunEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  public exportDiagnostics(): {
    timestamp: number;
    totalEvents: number;
    events: StructuredRunEvent[];
  } {
    return {
      timestamp: Date.now(),
      totalEvents: this.events.length,
      events: [...this.events]
    };
  }

  public clear(): void {
    this.events.length = 0;
  }
}
