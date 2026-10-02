import * as vscode from 'vscode';
import { assertWorkspaceFilePath } from '../core/workspacePaths';
import { isSensitivePath } from '../core/sensitivePaths';

export function isSensitiveContextPath(path: string): boolean {
  return isSensitivePath(path);
}

export async function canAttachWorkspaceContext(uri: vscode.Uri): Promise<boolean> {
  try {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || isSensitiveContextPath(vscode.workspace.asRelativePath(uri))) return false;
    if (uri.scheme === 'file' && folder.uri.scheme === 'file') await assertWorkspaceFilePath(folder.uri.fsPath, uri.fsPath);
    return true;
  } catch { return false; }
}
