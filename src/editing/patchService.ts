import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { validateRelativeWorkspacePath } from '../agent/workspaceTools';

export class StaleEditError extends Error {
  constructor(public readonly filePath: string, public readonly expectedHash: string, public readonly actualHash: string) {
    super(`File "${filePath}" was modified after the edit proposal was created. Edit cancelled to prevent overwriting changes.`);
    this.name = 'StaleEditError';
  }
}

export function computeContentHash(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function computeFileHash(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return computeContentHash(bytes);
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
      return '';
    }
    // Try node filesystem error code
    const errObj = error as { code?: string };
    if (errObj.code === 'ENOENT' || errObj.code === 'FileNotFound') {
      return '';
    }
    throw error;
  }
}

export async function applyFileEditSafely(
  uri: vscode.Uri,
  newContent: string,
  expectedOriginalHash: string
): Promise<void> {
  const currentHash = await computeFileHash(uri);
  if (expectedOriginalHash && currentHash !== expectedOriginalHash) {
    throw new StaleEditError(uri.fsPath, expectedOriginalHash, currentHash);
  }

  const encoded = Buffer.from(newContent, 'utf8');
  await vscode.workspace.fs.writeFile(uri, encoded);
}
