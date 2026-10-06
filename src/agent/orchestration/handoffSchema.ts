import { AgentRole } from './types';

export interface TestExecutionRecord {
  name: string;
  passed: boolean;
  outputSummary?: string;
  durationMs?: number;
}

export interface ProducedArtifactRecord {
  name: string;
  path?: string;
  summary: string;
}

export interface AgentHandoffV2 {
  schemaVersion: 2;
  taskId: string;
  agentId: string;
  role: AgentRole;
  status: 'success' | 'partial' | 'failure';
  filesModified: string[];
  testsExecuted: TestExecutionRecord[];
  keyDecisions: string[];
  unresolvedRisks: string[];
  nextSteps: string[];
  artifactsProduced: ProducedArtifactRecord[];
  confidenceScore: number;
  handoffMessage: string;
}

export class HandoffSerializer {
  public static create(data: Omit<AgentHandoffV2, 'schemaVersion'>): AgentHandoffV2 {
    const confidence = Math.max(0, Math.min(1, data.confidenceScore ?? 1.0));
    return {
      schemaVersion: 2,
      ...data,
      confidenceScore: confidence,
      filesModified: [...new Set(data.filesModified ?? [])],
      testsExecuted: data.testsExecuted ?? [],
      keyDecisions: data.keyDecisions ?? [],
      unresolvedRisks: data.unresolvedRisks ?? [],
      nextSteps: data.nextSteps ?? [],
      artifactsProduced: data.artifactsProduced ?? []
    };
  }

  public static formatForPrompt(handoff: AgentHandoffV2): string {
    const lines: string[] = [
      `=== STRUCTURED HANDOFF FROM ${handoff.role.toUpperCase()} (Task: ${handoff.taskId}) ===`,
      `Status: ${handoff.status.toUpperCase()} (Confidence: ${(handoff.confidenceScore * 100).toFixed(0)}%)`
    ];

    if (handoff.filesModified.length > 0) {
      lines.push(`Modified Files: ${handoff.filesModified.join(', ')}`);
    }

    if (handoff.testsExecuted.length > 0) {
      const passed = handoff.testsExecuted.filter((t) => t.passed).length;
      lines.push(`Tests: ${passed}/${handoff.testsExecuted.length} passed`);
    }

    if (handoff.keyDecisions.length > 0) {
      lines.push('Key Decisions:');
      for (const d of handoff.keyDecisions) {
        lines.push(`  - ${d}`);
      }
    }

    if (handoff.unresolvedRisks.length > 0) {
      lines.push('Unresolved Risks:');
      for (const r of handoff.unresolvedRisks) {
        lines.push(`  - ${r}`);
      }
    }

    if (handoff.nextSteps.length > 0) {
      lines.push('Recommended Next Steps:');
      for (const s of handoff.nextSteps) {
        lines.push(`  - ${s}`);
      }
    }

    lines.push(`Summary: ${handoff.handoffMessage}`);
    lines.push('==================================================');

    return lines.join('\n');
  }

  public static parse(raw: unknown): AgentHandoffV2 | null {
    if (!raw || typeof raw !== 'object') return null;

    const obj = raw as Record<string, unknown>;
    if (obj.schemaVersion === 2 && typeof obj.taskId === 'string' && typeof obj.role === 'string') {
      return this.create(obj as unknown as Omit<AgentHandoffV2, 'schemaVersion'>);
    }

    return null;
  }
}
