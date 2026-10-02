import * as vscode from 'vscode';
import { assertWorkspaceFilePath, validateWorkspaceRelativePath } from '../core/workspacePaths';
import { createUnifiedDiff } from './diffService';
import {
  computeContentHash,
  validateFileState,
  FileOriginalState,
  computeFileHash
} from './patchService';
import { EditJournal, RecoverySummary } from './editJournal';

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'stale' | 'failed' | 'reverted';

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
  recoveryId?: string;
}

export interface EditRollbackResult {
  recoveryId: string;
  success: boolean;
  restoredFiles: string[];
  unchangedFiles: string[];
  conflicts: Array<{ path: string; error: string }>;
}

export class EditEngine {
  private proposals = new Map<string, EditProposal>();
  private proposalRoots = new Map<string, vscode.Uri>();
  private applyingProposals = new Set<string>();
  private originalBytes = new Map<string, Map<string, Uint8Array>>();
  private mutationActive = false;
  private readonly journal: EditJournal;

  constructor(storage?: vscode.Memento, recoveryDirectory?: string) {
    this.journal = new EditJournal(storage, recoveryDirectory);
  }

  public getRecoveryHistory(): RecoverySummary[] {
    return this.journal.list();
  }

  public async forgetRecovery(id: string): Promise<void> {
    if (this.mutationActive) throw new Error('Wait for the current edit operation before removing recovery records.');
    this.mutationActive = true;
    try { await this.journal.forget(id); }
    finally { this.mutationActive = false; }
  }

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
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before preparing file edits.');
    if (!edits.length) throw new Error('An edit proposal must contain at least one file.');
    const proposalId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filePlans: FileEditPlan[] = [];
    const originalHashes: Record<string, string> = {};
    const patches: Record<string, string> = {};
    let totalAdditions = 0;
    let totalDeletions = 0;
    const targetPaths = new Set<string>();
    const originals = new Map<string, Uint8Array>();

    for (const edit of edits) {
      signal?.throwIfAborted();
      const segments = validateWorkspaceRelativePath(edit.path);
      const relativePath = segments.join('/');
      const normalizedPath = workspaceRoot.scheme === 'file' && process.platform === 'win32' ? relativePath.toLowerCase() : relativePath;
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
        originals.set(edit.path, Uint8Array.from(bytes));
      } catch (error) {
        if (!['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code || '')) throw error;
        originalContent = '';
        originalState = 'missing';
        originals.set(edit.path, new Uint8Array());
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
    this.originalBytes.set(proposalId, originals);
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
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before applying file edits.');
    if (this.applyingProposals.has(proposalId) || this.mutationActive) throw new Error('An edit operation is already in progress.');
    this.mutationActive = true;
    this.applyingProposals.add(proposalId);
    try {
      return await this.applyValidatedProposal(proposalId, selectedPaths, signal);
    } finally {
      this.applyingProposals.delete(proposalId);
      this.mutationActive = false;
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
      const recovery = await this.journal.prepare({
        proposalId,
        root: root.toString(),
        summary: proposal.summary.slice(0, 2000),
        files: filesToApply.map((file) => ({
          path: file.path,
          originalState: file.originalState,
          originalBytes: Buffer.from(this.originalBytes.get(proposalId)!.get(file.path)!).toString('base64'),
          originalHash: file.originalHash,
          expectedHash: computeContentHash(Buffer.from(file.newContent, 'utf8')),
          reverted: false
        }))
      });
      result.recoveryId = recovery.id;
      for (const file of filesToApply) {
        signal?.throwIfAborted();
        if (file.uri.scheme === 'file') await assertWorkspaceFilePath(root.fsPath, file.uri.fsPath, file.originalState === 'missing');
        this.assertNoUnsavedChanges(file.uri);
        const validation = await validateFileState(file.uri, file.originalState, file.originalHash);
        if (!validation.valid) throw new Error(`The file ${file.path} changed while its recovery snapshot was saved. No edits were submitted.`);
      }
      signal?.throwIfAborted();
      if (!vscode.workspace.isTrusted) throw new Error('Workspace trust changed before the edit was submitted.');
      const applied = await vscode.workspace.applyEdit(workspaceEdit);
      if (!applied) throw new Error('VS Code declined the edit transaction. No direct file-write fallback was attempted.');
      nativeApplied = true;

      const committed: Array<{ path: string; expectedHash: string }> = [];
      for (const file of filesToApply) {
        let expectedText = file.newContent;
        if (file.originalState === 'present') {
          const document = await vscode.workspace.openTextDocument(file.uri);
          if (document.isDirty && !await document.save()) {
            throw new Error(`Changes were applied in the editor, but ${file.path} could not be saved. Inspect the modified documents before continuing.`);
          }
          if (typeof document.getText === 'function') expectedText = document.getText();
        }
        const bytes = await vscode.workspace.fs.readFile(file.uri);
        if (new TextDecoder().decode(bytes) !== expectedText) throw new Error(`The applied content of ${file.path} changed unexpectedly. Inspect it before attempting recovery.`);
        committed.push({ path: file.path, expectedHash: computeContentHash(bytes) });
        await this.journal.update(recovery.id, 'prepared', [committed[committed.length - 1]]);
      }
      await this.journal.update(recovery.id, 'applied', committed);

      for (const file of filesToApply) {
        file.status = 'applied';
        result.appliedCount += 1;
        result.appliedFiles.push(file.path);
      }

      proposal.status = proposal.files.some((file) => file.status === 'pending' || file.status === 'approved') ? 'pending' : 'applied';
      result.success = true;
    } catch (error: any) {
      proposal.status = 'failed';
      if (result.recoveryId) {
        try { await this.journal.update(result.recoveryId, 'failed'); }
        catch (journalError) { result.errors.push({ path: 'recovery', error: `The prepared recovery snapshot was retained, but finalization failed: ${journalError instanceof Error ? journalError.message : String(journalError)}` }); }
      }
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

  public async rollbackChanges(recoveryId: string, selectedPaths?: string[], signal?: AbortSignal): Promise<EditRollbackResult> {
    if (this.mutationActive) throw new Error('An edit operation is already in progress.');
    if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before restoring file changes.');
    this.mutationActive = true;
    try {
      signal?.throwIfAborted();
      const record = this.journal.get(recoveryId);
      if (!record) throw new Error('The edit recovery record is unavailable.');
      const root = vscode.workspace.workspaceFolders?.find((folder) => folder.uri.toString() === record.root)?.uri;
      if (!root) throw new Error('Open the original workspace folder before restoring this edit.');
      const paths = selectedPaths ? new Set(selectedPaths) : undefined;
      if (paths && Array.from(paths).some((path) => !record.files.some((file) => file.path === path))) throw new Error('The rollback selection contains an unknown file.');
      const files = record.files.filter((file) => !file.reverted && (!paths || paths.has(file.path)));
      if (!files.length) throw new Error('No recoverable files were selected.');
      const result: EditRollbackResult = { recoveryId, success: false, restoredFiles: [], unchangedFiles: [], conflicts: [] };
      const targets: Array<{ file: typeof files[number]; uri: vscode.Uri }> = [];
      for (const file of files) {
        signal?.throwIfAborted();
        const uri = vscode.Uri.joinPath(root, ...validateWorkspaceRelativePath(file.path));
        try {
          if (uri.scheme === 'file') await assertWorkspaceFilePath(root.fsPath, uri.fsPath, true);
          this.assertNoUnsavedChanges(uri);
          const currentHash = await computeFileHash(uri);
          if (currentHash === file.originalHash) {
            result.unchangedFiles.push(file.path);
          } else if (currentHash === file.expectedHash) {
            targets.push({ file, uri });
          } else {
            result.conflicts.push({ path: file.path, error: 'This file changed after the recorded edit. No files were restored.' });
          }
        } catch (error) {
          result.conflicts.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
        }
      }
      if (result.conflicts.length) return result;
      signal?.throwIfAborted();
      if (targets.length) {
        const edit = new vscode.WorkspaceEdit();
        for (const { file, uri } of targets) {
          this.assertNoUnsavedChanges(uri);
          if (file.originalState === 'missing') edit.deleteFile(uri, { recursive: false, ignoreIfNotExists: false });
          else edit.createFile(uri, { overwrite: true, contents: Buffer.from(file.originalBytes, 'base64') });
        }
        signal?.throwIfAborted();
        if (!vscode.workspace.isTrusted) throw new Error('Workspace trust changed before rollback was submitted.');
        if (!await vscode.workspace.applyEdit(edit)) {
          result.conflicts.push({ path: 'transaction', error: 'VS Code declined the rollback transaction. No direct file-write fallback was attempted.' });
          return result;
        }
        for (const { file, uri } of targets) {
          if (await computeFileHash(uri) === file.originalHash) result.restoredFiles.push(file.path);
          else result.conflicts.push({ path: file.path, error: 'Rollback did not restore the exact original file state. Inspect the file and retained recovery snapshot.' });
        }
      }
      const reverted = [...result.restoredFiles, ...result.unchangedFiles];
      const allReverted = record.files.every((file) => file.reverted || reverted.includes(file.path));
      await this.journal.update(recoveryId, allReverted ? 'reverted' : 'partially_reverted', reverted.map((path) => ({ path, reverted: true })));
      const proposal = this.proposals.get(record.proposalId);
      if (proposal) {
        for (const file of proposal.files) if (reverted.includes(file.path)) file.status = 'reverted';
        proposal.status = proposal.files.every((file) => file.status === 'reverted') ? 'reverted' : proposal.status;
      }
      result.success = result.conflicts.length === 0;
      return result;
    } finally {
      this.mutationActive = false;
    }
  }

  private assertNoUnsavedChanges(uri: vscode.Uri): void {
    const document = vscode.workspace.textDocuments?.find((candidate) => candidate.uri.toString() === uri.toString());
    if (document?.isDirty) throw new Error('Save or discard your unsaved changes to this file before generating or applying an edit proposal.');
  }

  public rejectProposal(proposalId: string): void {
    if (this.applyingProposals.has(proposalId)) throw new Error('An accepted edit is already being applied. Wait for it to finish, then use recorded Undo.');
    const proposal = this.proposals.get(proposalId);
    if (proposal) {
      for (const file of proposal.files) {
        if (file.status === 'pending' || file.status === 'approved') file.status = 'rejected';
      }
      proposal.status = proposal.files.some((file) => file.status === 'applied') ? 'applied' : 'rejected';
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
