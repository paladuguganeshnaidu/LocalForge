export type RunnerJobStatus =
  | 'queued'
  | 'cloning'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunnerJobSubmission {
  jobId: string;
  runId: string;
  goal: string;
  repositoryUrl?: string;
  commitHash?: string;
  executionTier: string;
  maxDurationMs: number;
  environmentOverrides?: Record<string, string>;
}

export interface RunnerJobProgress {
  jobId: string;
  step: string;
  status: RunnerJobStatus;
  outputChunk?: string;
  filesModified?: string[];
  timestamp: number;
}

export interface RunnerJobResult {
  jobId: string;
  status: 'completed' | 'failed' | 'cancelled';
  exitCode: number;
  summary: string;
  filesModified: string[];
  durationMs: number;
  artifacts: Array<{ name: string; url?: string; summary: string }>;
}

export class RunnerProtocol {
  public static serializeSubmission(job: RunnerJobSubmission): string {
    return JSON.stringify({ type: 'JOB_SUBMIT', payload: job });
  }

  public static parseProgress(raw: string): RunnerJobProgress | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type === 'JOB_PROGRESS' && parsed.payload) {
        return parsed.payload as RunnerJobProgress;
      }
      return null;
    } catch {
      return null;
    }
  }

  public static parseResult(raw: string): RunnerJobResult | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.type === 'JOB_RESULT' && parsed.payload) {
        return parsed.payload as RunnerJobResult;
      }
      return null;
    } catch {
      return null;
    }
  }
}
