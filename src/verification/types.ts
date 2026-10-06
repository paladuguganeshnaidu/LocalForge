import * as crypto from 'crypto';

export type EvidenceType =
  | 'build'
  | 'test'
  | 'diagnostic'
  | 'browser'
  | 'security'
  | 'performance'
  | 'diff';

export interface EvidenceArtifact {
  id: string;
  type: EvidenceType;
  producer: string;
  timestamp: number;
  commandOrAction?: string;
  exitCode?: number;
  summary: string;
  passed: boolean;
  immutableHash: string;
}

export interface VerificationStep {
  type: EvidenceType;
  description: string;
  command?: string;
  mandatory: boolean;
}

export function computeEvidenceHash(artifact: Omit<EvidenceArtifact, 'id' | 'immutableHash'>): string {
  const content = JSON.stringify({
    type: artifact.type,
    producer: artifact.producer,
    commandOrAction: artifact.commandOrAction,
    exitCode: artifact.exitCode,
    summary: artifact.summary,
    passed: artifact.passed
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}
