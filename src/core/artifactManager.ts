export type ArtifactType =
  | 'Task List'
  | 'Implementation Plan'
  | 'Code Diff'
  | 'Walkthrough'
  | 'Test Report'
  | 'Context Report'
  | 'GPU Report';

export type ArtifactStatus = 'pending' | 'reviewed' | 'approved' | 'rejected';

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  createdAt: number;
  status: ArtifactStatus;
  conversationId?: string;
  turnId?: string;
  content: string;
  relatedFiles?: string[];
  metadata?: Record<string, unknown>;
  comments?: Array<{ author: string; text: string; createdAt: number; line?: number; path?: string }>;
}

export class ArtifactManager {
  private artifacts = new Map<string, Artifact>();

  public createArtifact(params: {
    type: ArtifactType;
    title: string;
    content: string;
    conversationId?: string;
    turnId?: string;
    relatedFiles?: string[];
    metadata?: Record<string, unknown>;
  }): Artifact {
    const id = `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const artifact: Artifact = {
      id,
      type: params.type,
      title: params.title,
      createdAt: Date.now(),
      status: 'pending',
      conversationId: params.conversationId,
      turnId: params.turnId,
      content: params.content,
      relatedFiles: params.relatedFiles || [],
      metadata: params.metadata || {},
      comments: []
    };

    this.artifacts.set(id, artifact);
    return artifact;
  }

  public getArtifact(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  public getArtifactsByTurn(turnId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter((a) => a.turnId === turnId);
  }

  public getArtifactsByConversation(conversationId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter((a) => a.conversationId === conversationId);
  }

  public purgeConversation(conversationId: string): void {
    for (const [id, artifact] of this.artifacts) if (artifact.conversationId === conversationId) this.artifacts.delete(id);
  }

  public updateStatus(id: string, status: ArtifactStatus): Artifact | undefined {
    const artifact = this.artifacts.get(id);
    if (artifact) {
      artifact.status = status;
    }
    return artifact;
  }

  public addComment(
    id: string,
    comment: { author: string; text: string; line?: number; path?: string }
  ): void {
    const artifact = this.artifacts.get(id);
    if (artifact) {
      artifact.comments = artifact.comments || [];
      artifact.comments.push({
        ...comment,
        createdAt: Date.now()
      });
    }
  }

  public createWalkthrough(params: {
    summary: string;
    filesChanged: string[];
    behaviorChanges?: string;
    testsRun?: string;
    validationResult?: string;
    limitations?: string;
    verificationSteps?: string;
    conversationId?: string;
    turnId?: string;
  }): Artifact {
    const content = [
      `## Summary\n${params.summary}`,
      `\n## Files Changed\n${params.filesChanged.map((f) => `- \`${f}\``).join('\n') || 'None'}`,
      params.behaviorChanges ? `\n## Behavior Changes\n${params.behaviorChanges}` : '',
      params.testsRun ? `\n## Tests Executed\n${params.testsRun}` : '',
      params.validationResult ? `\n## Validation Result\n${params.validationResult}` : '',
      params.limitations ? `\n## Known Limitations\n${params.limitations}` : '',
      params.verificationSteps ? `\n## Manual Verification Steps\n${params.verificationSteps}` : ''
    ].filter(Boolean).join('\n');

    return this.createArtifact({
      type: 'Walkthrough',
      title: 'Implementation Walkthrough',
      content,
      conversationId: params.conversationId,
      turnId: params.turnId,
      relatedFiles: params.filesChanged
    });
  }
}
