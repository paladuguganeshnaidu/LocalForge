import * as vscode from 'vscode';
import { assertWorkspaceFilePath, validateWorkspaceRelativePath } from '../core/workspacePaths';
import { createUnifiedDiff } from './diffService';
import {
  computeContentHash,
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
  private proposalRoots = new Map<string, vscode.Uri>();
  private applyingProposals = new Set<string>();

  /**
   * Propose a set of edits across one or more files in the workspace.
   */
  public async proposeEdits(
    workspaceRoot: vscode.Uri,
    edits: Array<{ path: string; newContent: string }>,
    summary: string = 'Multi-file code changes',
    metadata?: { conversationId?: string; turnId?: string },
    signal?: AbortSignal
  ): Promise<EditProposal> {
    if (!edits.length) throw new Error('An edit proposal must contain at least one file.');
    const proposalId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filePlans: FileEditPlan[] = [];
    const originalHashes: Record<string, string> = {};
    const patches: Record<string, string> = {};
    let totalAdditions = 0;
    let totalDeletions = 0;
    const targetPaths = new Set<string>();

    for (const edit of edits) {
      signal?.throwIfAborted();
      const segments = validateWorkspaceRelativePath(edit.path);
      const normalizedPath = segments.join('/');
      if (targetPaths.has(normalizedPath)) throw new Error('An edit proposal cannot contain duplicate file paths.');
      targetPaths.add(normalizedPath);
      const uri = vscode.Uri.joinPath(workspaceRoot, ...segments);
      if (uri.scheme === 'file') await assertWorkspaceFilePath(workspaceRoot.fsPath, uri.fsPath, true);
      this.assertNoUnsavedChanges(uri);
      let originalContent = '';
      let originalState: FileOriginalState = 'missing';
      let hash = '';

      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        originalContent = new TextDecoder().decode(bytes);
        originalState = 'present';
        hash = computeContentHash(bytes);
      } catch (error) {
        if (!['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code || '')) throw error;
        originalContent = '';
        originalState = 'missing';
      }

      signal?.throwIfAborted();
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
    this.proposalRoots.set(proposalId, workspaceRoot);
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
   * Validate every target before submitting one native WorkspaceEdit.
   */
  public async applyProposal(
    proposalId: string,
    selectedPaths?: string[],
    signal?: AbortSignal
  ): Promise<EditApplyResult> {
    if (this.applyingProposals.has(proposalId)) throw new Error('This proposal is already being applied.');
    this.applyingProposals.add(proposalId);
    try {
      return await this.applyValidatedProposal(proposalId, selectedPaths, signal);
    } finally {
      this.applyingProposals.delete(proposalId);
    }
  }

  private async applyValidatedProposal(
    proposalId: string,
    selectedPaths?: string[],
    signal?: AbortSignal
  ): Promise<EditApplyResult> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new Error(`Proposal ${proposalId} not found.`);
    signal?.throwIfAborted();
    if (proposal.status !== 'pending' && proposal.status !== 'approved') {
      throw new Error(`Proposal ${proposalId} is ${proposal.status} and cannot be applied.`);
    }
    const root = this.proposalRoots.get(proposalId);
    if (!root) throw new Error('The proposal workspace root is unavailable. Generate a new proposal.');

    const targetPaths = selectedPaths ? new Set(selectedPaths) : null;
    const filesToApply = proposal.files.filter((file) =>
      (file.status === 'pending' || file.status === 'approved') && (!targetPaths || targetPaths.has(file.path)));
    if (!filesToApply.length) throw new Error('No pending proposal files were selected.');

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
      signal?.throwIfAborted();
      if (file.uri.scheme === 'file') await assertWorkspaceFilePath(root.fsPath, file.uri.fsPath, file.originalState === 'missing');
      this.assertNoUnsavedChanges(file.uri);
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

    let nativeApplied = false;
    try {
      signal?.throwIfAborted();
      const workspaceEdit = new vscode.WorkspaceEdit();
      for (const file of filesToApply) {
        if (file.originalState === 'missing') {
          workspaceEdit.createFile(file.uri, {
            ignoreIfExists: false,
            overwrite: false,
            contents: Buffer.from(file.newContent, 'utf8')
          });
        } else {
          workspaceEdit.replace(
            file.uri,
            new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1000000, 0)),
            file.newContent
          );
        }
      }

      signal?.throwIfAborted();
      for (const file of filesToApply) this.assertNoUnsavedChanges(file.uri);
      const applied = await vscode.workspace.applyEdit(workspaceEdit);
      if (!applied) throw new Error('VS Code declined the edit transaction. No direct file-write fallback was attempted.');
      nativeApplied = true;

      for (const file of filesToApply) {
        if (file.originalState === 'present') {
          const document = await vscode.workspace.openTextDocument(file.uri);
          if (document.isDirty && !await document.save()) {
            throw new Error(`Changes were applied in the editor, but ${file.path} could not be saved. Inspect the modified documents before continuing.`);
          }
        }
      }

      for (const file of filesToApply) {
        file.status = 'applied';
        result.appliedCount += 1;
        result.appliedFiles.push(file.path);
      }

      proposal.status = proposal.files.some((file) => file.status === 'pending' || file.status === 'approved') ? 'pending' : 'applied';
      result.success = true;
    } catch (error: any) {
      proposal.status = 'failed';
      if (nativeApplied) {
        result.appliedCount = filesToApply.length;
        result.appliedFiles = filesToApply.map((file) => file.path);
      }
      result.failedCount = filesToApply.length;
      result.errors.push({ path: 'transaction', error: error.message || String(error) });
      result.success = false;
    }

    return result;
  }

  private assertNoUnsavedChanges(uri: vscode.Uri): void {
    const document = vscode.workspace.textDocuments?.find((candidate) => candidate.uri.toString() === uri.toString());
    if (document?.isDirty) throw new Error('Save or discard your unsaved changes to this file before generating or applying an edit proposal.');
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
