import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

export type FileOriginalState = 'present' | 'missing';

export class StaleEditError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expectedHash: string,
    public readonly actualHash: string
  ) {
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
    const errObj = error as { code?: string };
    if (errObj.code === 'ENOENT' || errObj.code === 'FileNotFound') {
      return '';
    }
    throw error;
  }
}

export async function validateFileState(
  uri: vscode.Uri,
  originalState: FileOriginalState,
  expectedHash: string
): Promise<{ valid: boolean; currentHash: string; error?: string }> {
  const currentHash = await computeFileHash(uri);

  if (originalState === 'missing') {
    if (currentHash !== '') {
      return {
        valid: false,
        currentHash,
        error: `File "${uri.fsPath}" did not exist when proposed but now exists.`
      };
    }
    return { valid: true, currentHash: '' };
  }

  if (currentHash !== expectedHash) {
    return {
      valid: false,
      currentHash,
      error: `File "${uri.fsPath}" hash changed from ${expectedHash.slice(0, 8)} to ${currentHash.slice(0, 8)}.`
    };
  }

  return { valid: true, currentHash };
}

export async function applyFileEditSafely(
  uri: vscode.Uri,
  newContent: string,
  expectedOriginalHash: string,
  originalState: FileOriginalState = 'present'
): Promise<void> {
  const validation = await validateFileState(uri, originalState, expectedOriginalHash);
  if (!validation.valid) {
    throw new StaleEditError(uri.fsPath, expectedOriginalHash, validation.currentHash);
  }

  const encoded = Buffer.from(newContent, 'utf8');
  await vscode.workspace.fs.writeFile(uri, encoded);
}
