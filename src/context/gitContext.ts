import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface GitWorkspaceState {
  isGitRepo: boolean;
  branch?: string;
  hasUncommittedChanges: boolean;
  modifiedFiles: string[];
  statusSummary: string;
  diffSummary?: string;
}

export class GitContextService {
  public async getWorkspaceGitState(workspaceRoot: vscode.Uri): Promise<GitWorkspaceState> {
    try {
      const cwd = workspaceRoot.fsPath;
      // Check branch
      const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd, timeout: 5000 });
      const branch = branchOut.trim();

      // Check status --porcelain
      const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd, timeout: 5000 });
      const statusLines = statusOut.trim().split('\n').filter(Boolean);
      const modifiedFiles = statusLines.map((line) => line.slice(3).trim());
      const hasUncommittedChanges = statusLines.length > 0;

      // Check diff (bounded)
      let diffSummary: string | undefined;
      if (hasUncommittedChanges) {
        try {
          const { stdout: diffOut } = await execAsync('git diff --stat', { cwd, timeout: 5000 });
          diffSummary = diffOut.trim().slice(0, 2000);
        } catch {}
      }

      return {
        isGitRepo: true,
        branch,
        hasUncommittedChanges,
        modifiedFiles,
        statusSummary: statusOut.trim().slice(0, 3000),
        diffSummary
      };
    } catch {
      return {
        isGitRepo: false,
        hasUncommittedChanges: false,
        modifiedFiles: [],
        statusSummary: 'Not a git repository or git command not available.'
      };
    }
  }
}
