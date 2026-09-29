import * as vscode from 'vscode';
import { createUnifiedDiff } from './diffService';
import {
  computeFileHash,
  validateFileState,
  FileOriginalState,
  StaleEditError
} from './patchService';

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'stale' | 'failed';

export interface FileEditPlan {
  path: string;
  uri: vscode.Uri;
  originalState: FileOriginalState;
  originalHash: string;
  currentHash: string;
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
  conversationId?: string;
  turnId?: string;
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
  success: boolean;
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
    summary: string = 'Multi-file code changes',
    metadata?: { conversationId?: string; turnId?: string }
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
      let originalState: FileOriginalState = 'missing';

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        originalContent = new TextDecoder().decode(bytes);
        originalState = 'present';
      } catch {
        originalContent = '';
        originalState = 'missing';
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
        originalState,
        originalHash: hash,
        currentHash: hash,
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
      conversationId: metadata?.conversationId,
      turnId: metadata?.turnId,
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

  public getProposalsForTurn(turnId: string): EditProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.turnId === turnId);
  }

  public getPendingProposals(): EditProposal[] {
    return Array.from(this.proposals.values()).filter((p) => p.status === 'pending');
  }

  /**
   * Open VS Code native diff editor to inspect the proposed changes.
   */
  public async showDiff(proposalId: string, filePath: string): Promise<void> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);

    const filePlan = proposal.files.find((f) => f.path === filePath);
    if (!filePlan) throw new Error(`File ${filePath} not in proposal.`);

    const proposedDocument = await vscode.workspace.openTextDocument({
      content: filePlan.newContent,
      language: 'plaintext'
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      filePlan.uri,
      proposedDocument.uri,
      filePath + ' (Proposed Changes)'
    );
  }

  /**
   * Atomic two-phase multi-file application:
   * Phase 1: validate all file hashes against expected originalHash and originalState.
   * If ANY file is stale, apply none.
   * Phase 2: apply all changes atomically via WorkspaceEdit.
   */
  public async applyProposal(
    proposalId: string,
    selectedPaths?: string[]
  ): Promise<EditApplyResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);

    const targetPaths = selectedPaths ? new Set(selectedPaths) : null;
    const filesToApply = proposal.files.filter((f) => !targetPaths || targetPaths.has(f.path));

    const result: EditApplyResult = {
      proposalId,
      success: false,
      appliedCount: 0,
      rejectedCount: proposal.files.length - filesToApply.length,
      failedCount: 0,
      staleCount: 0,
      appliedFiles: [],
      errors: []
    };

    // Phase 1: Validate all target files
    let hasStale = false;
    for (const file of filesToApply) {
      const validation = await validateFileState(file.uri, file.originalState, file.originalHash);
      file.currentHash = validation.currentHash;

      if (!validation.valid) {
        file.status = 'stale';
        file.error = validation.error;
        result.staleCount += 1;
        result.errors.push({ path: file.path, error: validation.error || 'File modified' });
        hasStale = true;
      }
    }

    // If any target file is stale, abort all changes
    if (hasStale) {
      proposal.status = 'stale';
      result.success = false;
      return result;
    }

    // Phase 2: Apply all changes as one VS Code workspace transaction.
    try {
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const file of filesToApply) {
        if (file.originalState === 'missing') {
          workspaceEdit.createFile(file.uri, { ignoreIfExists: false, overwrite: false });
          workspaceEdit.insert(file.uri, new vscode.Position(0, 0), file.newContent);
          continue;
        }

        const document = await vscode.workspace.openTextDocument(file.uri);
        const endPosition = document.positionAt(document.getText().length);
        workspaceEdit.replace(file.uri, new vscode.Range(new vscode.Position(0, 0), endPosition), file.newContent);
      }

      const applied = await vscode.workspace.applyEdit(workspaceEdit);
      if (!applied) throw new Error('VS Code rejected the multi-file workspace edit. No changes were reported as applied.');

      for (const file of filesToApply) {
        file.status = 'applied';
        result.appliedCount += 1;
        result.appliedFiles.push(file.path);
      }

      proposal.status = 'applied';
      result.success = true;
    } catch (error: any) {
      proposal.status = 'failed';
      result.failedCount = filesToApply.length;
      result.errors.push({ path: 'transaction', error: error.message || String(error) });
      result.success = false;
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
