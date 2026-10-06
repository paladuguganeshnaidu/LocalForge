import {
  computeEvidenceHash,
  EvidenceArtifact,
  EvidenceType,
  VerificationStep
} from './types';

export class EvidencePlanner {
  private readonly artifacts = new Map<string, EvidenceArtifact>();

  public planVerification(changedFiles: string[]): VerificationStep[] {
    const steps: VerificationStep[] = [];

    const hasTsOrJs = changedFiles.some((f) => /\.(ts|tsx|js|jsx)$/.test(f));
    const hasTests = changedFiles.some((f) => f.includes('.test.') || f.includes('.spec.'));
    const hasUi = changedFiles.some((f) => f.includes('/ui/') || f.endsWith('.html') || f.endsWith('.css'));

    // 1. Compile / Typecheck
    if (hasTsOrJs) {
      steps.push({
        type: 'build',
        description: 'Compile and typecheck TypeScript source',
        command: 'npm run compile',
        mandatory: true
      });
    }

    // 2. Automated Tests
    steps.push({
      type: 'test',
      description: 'Run project automated test suite',
      command: hasTests ? 'npm test' : 'npm test',
      mandatory: true
    });

    // 3. UI evidence
    if (hasUi) {
      steps.push({
        type: 'browser',
        description: 'Verify UI rendering and absence of console errors',
        mandatory: false
      });
    }

    // 4. Security Audit
    steps.push({
      type: 'security',
      description: 'Audit code modifications for secrets, injection, and path safety',
      mandatory: true
    });

    return steps;
  }

  public recordArtifact(artifactData: Omit<EvidenceArtifact, 'id' | 'immutableHash'>): EvidenceArtifact {
    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const immutableHash = computeEvidenceHash(artifactData);

    const artifact: EvidenceArtifact = {
      id,
      ...artifactData,
      immutableHash
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  public getArtifacts(): readonly EvidenceArtifact[] {
    return Array.from(this.artifacts.values());
  }

  public computeVerificationScore(requiredSteps: VerificationStep[]): {
    score: number;
    passed: boolean;
    missingMandatory: string[];
  } {
    const recorded = Array.from(this.artifacts.values());
    const mandatorySteps = requiredSteps.filter((s) => s.mandatory);

    const missingMandatory: string[] = [];

    for (const step of mandatorySteps) {
      const match = recorded.find((a) => a.type === step.type && a.passed);
      if (!match) {
        missingMandatory.push(step.description);
      }
    }

    const totalMandatory = mandatorySteps.length;
    const passedMandatory = totalMandatory - missingMandatory.length;
    const score = totalMandatory > 0 ? (passedMandatory / totalMandatory) * 100 : 100;

    return {
      score,
      passed: missingMandatory.length === 0,
      missingMandatory
    };
  }
}
