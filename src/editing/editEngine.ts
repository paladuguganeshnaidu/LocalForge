import * as vscode from 'vscode';
import { createUnifiedDiff } from './diffService';
import { assertWorkspacePath, normalizeWorkspaceRelativePath } from '../security/pathPolicy';
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
      const normalizedPath = normalizeWorkspaceRelativePath(edit.path);
      await assertWorkspacePath(workspaceRoot.fsPath, normalizedPath, { allowMissing: true });
      const uri = vscode.Uri.joinPath(workspaceRoot, ...normalizedPath.split('/'));
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
        path: normalizedPath,
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

    const tempDocUri = vscode.Uri.parse(`localforge-proposed:${filePath}?proposal=${proposalId}`);

    await vscode.commands.executeCommand(
      'vscode.diff',
      filePlan.uri,
      tempDocUri,
      `${filePath} (Proposed Changes)`
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

    // Phase 2: Apply all changes atomically
    try {
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const file of filesToApply) {
        if (file.originalState === 'missing') {
          workspaceEdit.createFile(file.uri, { ignoreIfExists: false, overwrite: false });
        }
        workspaceEdit.replace(
          file.uri,
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1000000, 0)),
          file.newContent
        );
      }

      // If workspaceEdit execution is supported (inside VS Code host)
      let applied = false;
      try {
        applied = await vscode.workspace.applyEdit(workspaceEdit);
      } catch {
        // Fallback to direct writes if headless testing
        applied = false;
      }

      if (!applied) {
        const originalContents = new Map<string, Uint8Array | undefined>();
        const appliedUris: vscode.Uri[] = [];
        try {
          for (const file of filesToApply) {
            try {
              originalContents.set(file.uri.fsPath || file.uri.path, await vscode.workspace.fs.readFile(file.uri));
            } catch {
              originalContents.set(file.uri.fsPath || file.uri.path, undefined);
            }
          }

          for (const file of filesToApply) {
            if (file.originalState === 'missing') {
              // EditEngine remains the canonical mutation gateway; this fallback is
              // only used when WorkspaceEdit is unavailable in a virtual/headless host.
              await vscode.workspace.fs.writeFile(file.uri, Buffer.from(file.newContent, 'utf8'));
            } else {
              await vscode.workspace.fs.writeFile(file.uri, Buffer.from(file.newContent, 'utf8'));
            }
            appliedUris.push(file.uri);
          }
        } catch (fallbackError: any) {
          for (const uri of appliedUris.reverse()) {
            const key = uri.fsPath || uri.path;
            const original = originalContents.get(key);
            if (original) {
              await vscode.workspace.fs.writeFile(uri, original);
            } else {
              try { await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false }); } catch {}
            }
          }
          throw fallbackError;
        }
      }

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

  public async deleteFile(workspaceRoot: vscode.Uri, relativePath: string): Promise<void> {
    const normalized = normalizeWorkspaceRelativePath(relativePath);
    const target = await assertWorkspacePath(workspaceRoot.fsPath, normalized);
    await vscode.workspace.fs.delete(vscode.Uri.file(target.absolutePath), { recursive: false, useTrash: true });
  }

  public async moveFile(workspaceRoot: vscode.Uri, sourcePath: string, destinationPath: string): Promise<void> {
    const source = normalizeWorkspaceRelativePath(sourcePath);
    const destination = normalizeWorkspaceRelativePath(destinationPath);
    const sourceResolved = await assertWorkspacePath(workspaceRoot.fsPath, source);
    const destinationResolved = await assertWorkspacePath(workspaceRoot.fsPath, destination, { allowMissing: true });
    if (destinationResolved.exists) throw new Error('Destination file already exists.');
    await vscode.workspace.fs.rename(
      vscode.Uri.file(sourceResolved.absolutePath),
      vscode.Uri.file(destinationResolved.absolutePath),
      { overwrite: false }
    );
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

  public createContentProvider(): ProposedContentProvider {
    return new ProposedContentProvider(this);
  }
}

export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly editEngine: EditEngine) {}

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const proposalId = new URLSearchParams(uri.query).get('proposal');
    if (!proposalId) return '';
    const proposal = this.editEngine.getProposal(proposalId);
    if (!proposal) return '';
    const rawPath = uri.path.replace(/^\//, '');
    const file = proposal.files.find((f) => f.path === rawPath || f.path === uri.path);
    return file ? file.newContent : '';
  }

  public update(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }
}

