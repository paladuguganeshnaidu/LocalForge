import * as vscode from 'vscode';
import { createUnifiedDiff } from './diffService';
import { applyFileEditSafely, computeFileHash, StaleEditError } from './patchService';

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'stale' | 'failed';

export interface FileEditPlan {
  path: string;
  uri: vscode.Uri;
  originalHash: string;
  originalContent: string;
  newContent: string;
  patch: string;
  additions: number;
  deletions: number;
  status: EditStatus;
  error?: string;
}

export interface EditProposal {
  id: string;
  summary: string;
  createdAt: number;
  status: EditStatus;
  files: FileEditPlan[];
  originalHashes: Record<string, string>;
  patches: Record<string, string>;
  additions: number;
  deletions: number;
}

export interface EditApplyResult {
  proposalId: string;
  appliedCount: number;
  rejectedCount: number;
  failedCount: number;
  staleCount: number;
  appliedFiles: string[];
  errors: Array<{ path: string; error: string }>;
}

export class EditEngine {
  private proposals = new Map<string, EditProposal>();

  /**
   * Propose a set of edits across one or more files in the workspace.
   */
  public async proposeEdits(
    workspaceRoot: vscode.Uri,
    edits: Array<{ path: string; newContent: string }>,
    summary: string = 'Multi-file code changes'
  ): Promise<EditProposal> {
    const proposalId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filePlans: FileEditPlan[] = [];
    const originalHashes: Record<string, string> = {};
    const patches: Record<string, string> = {};
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const edit of edits) {
      const uri = vscode.Uri.joinPath(workspaceRoot, edit.path);
      let originalContent = '';
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        originalContent = new TextDecoder().decode(bytes);
      } catch {
        // File does not exist yet (creation)
        originalContent = '';
      }

      const hash = await computeFileHash(uri);
      const diff = createUnifiedDiff(edit.path, originalContent, edit.newContent);

      originalHashes[edit.path] = hash;
      patches[edit.path] = diff.patch;
      totalAdditions += diff.stats.additions;
      totalDeletions += diff.stats.deletions;

      filePlans.push({
        path: edit.path,
        uri,
        originalHash: hash,
        originalContent,
        newContent: edit.newContent,
        patch: diff.patch,
        additions: diff.stats.additions,
        deletions: diff.stats.deletions,
        status: 'pending'
      });
    }

    const proposal: EditProposal = {
      id: proposalId,
      summary,
      createdAt: Date.now(),
      status: 'pending',
      files: filePlans,
      originalHashes,
      patches,
      additions: totalAdditions,
      deletions: totalDeletions
    };

    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  public getProposal(proposalId: string): EditProposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * Open VS Code native diff editor to inspect the proposed changes.
   */
  public async showDiff(proposalId: string, filePath: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);

    const filePlan = proposal.files.find((f) => f.path === filePath);
    if (!filePlan) throw new Error(`File ${filePath} not in proposal.`);

    // Create an in-memory virtual document for the modified version
    const tempDocUri = vscode.Uri.parse(`localforge-proposed:${filePath}?proposal=${proposalId}`);
    
    // Register temporary text document content provider if not registered
    await vscode.commands.executeCommand(
      'vscode.diff',
      filePlan.uri,
      tempDocUri,
      `${filePath} (Proposed Changes)`
    );
  }

  /**
   * Apply approved changes with atomic hash validation.
   */
  public async applyProposal(
    proposalId: string,
    selectedPaths?: string[]
  ): Promise<EditApplyResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);

    const targetPaths = selectedPaths ? new Set(selectedPaths) : null;
    const result: EditApplyResult = {
      proposalId,
      appliedCount: 0,
      rejectedCount: 0,
      failedCount: 0,
      staleCount: 0,
      appliedFiles: [],
      errors: []
    };

    for (const file of proposal.files) {
      if (targetPaths && !targetPaths.has(file.path)) {
        file.status = 'rejected';
        result.rejectedCount += 1;
        continue;
      }

      try {
        await applyFileEditSafely(file.uri, file.newContent, file.originalHash);
        file.status = 'applied';
        result.appliedCount += 1;
        result.appliedFiles.push(file.path);
      } catch (error) {
        if (error instanceof StaleEditError) {
          file.status = 'stale';
          result.staleCount += 1;
          result.errors.push({ path: file.path, error: error.message });
        } else {
          file.status = 'failed';
          result.failedCount += 1;
          const msg = error instanceof Error ? error.message : String(error);
          result.errors.push({ path: file.path, error: msg });
        }
      }
    }

    if (result.failedCount > 0 || result.staleCount > 0) {
      proposal.status = result.appliedCount > 0 ? 'applied' : 'failed';
    } else if (result.appliedCount > 0) {
      proposal.status = 'applied';
    } else {
      proposal.status = 'rejected';
    }

    return result;
  }

  public rejectProposal(proposalId: string): void {
    const proposal = this.proposals.get(proposalId);
    if (proposal) {
      proposal.status = 'rejected';
      for (const file of proposal.files) {
        file.status = 'rejected';
      }
    }
  }
}
