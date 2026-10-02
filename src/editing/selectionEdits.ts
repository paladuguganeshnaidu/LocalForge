import * as vscode from 'vscode';
import { EditApplyResult, EditEngine } from './editEngine';

export async function applyReviewedSelection(
  editEngine: EditEngine,
  document: vscode.TextDocument,
  range: vscode.Range,
  replacement: string,
  signal?: AbortSignal
): Promise<EditApplyResult> {
  signal?.throwIfAborted();
  if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before applying an edit.');
  if (document.isDirty || document.isClosed) throw new Error('Save or reopen the original file before applying this reviewed edit.');
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) throw new Error('Open the file inside its workspace folder before applying this edit.');
  const original = document.getText();
  const version = document.version;
  const start = document.offsetAt(range.start);
  const end = document.offsetAt(range.end);
  const newContent = original.slice(0, start) + replacement + original.slice(end);
  const path = vscode.workspace.asRelativePath(document.uri, false);
  const proposal = await editEngine.proposeEdits(folder.uri, [{ path, newContent }], `Reviewed selection edit: ${path}`, undefined, signal);
  if (document.version !== version || document.isDirty || proposal.files[0].originalContent !== original) {
    editEngine.rejectProposal(proposal.id);
    throw new Error('The source changed while preparing the recorded edit. Generate a fresh proposal.');
  }
  return editEngine.applyProposal(proposal.id, undefined, signal);
}
