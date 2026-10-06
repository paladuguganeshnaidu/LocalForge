import * as child_process from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ActiveWorktree {
  id: string;
  runId: string;
  agentId: string;
  branchName: string;
  worktreePath: string;
  createdAt: number;
}

export interface MergePreviewResult {
  hasConflict: boolean;
  changedFiles: string[];
  diffStat: string;
  diffContent: string;
}

export class WorktreeManager {
  private readonly activeWorktrees = new Map<string, ActiveWorktree>();

  constructor(private readonly workspaceRoot: string) {}

  private execGit(args: string[], cwd = this.workspaceRoot): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      child_process.execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error ? (error.code as number ?? 1) : 0
        });
      });
    });
  }

  public async isGitRepository(): Promise<boolean> {
    const res = await this.execGit(['rev-parse', '--is-inside-work-tree']);
    return res.exitCode === 0 && res.stdout.trim() === 'true';
  }

  public async createWorktree(runId: string, agentId: string): Promise<ActiveWorktree> {
    const isRepo = await this.isGitRepository();
    if (!isRepo) {
      throw new Error(`Cannot create Git worktree: "${this.workspaceRoot}" is not a Git repository.`);
    }

    const branchName = `tuxnest/wt/${runId}/${agentId}`;
    const tempDir = path.join(os.tmpdir(), `tuxnest_wt_${runId}_${agentId}`);

    // If leftover directory exists, remove it
    if (fs.existsSync(tempDir)) {
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }

    // git worktree add -b <branchName> <tempDir> HEAD
    const addRes = await this.execGit(['worktree', 'add', '-b', branchName, tempDir, 'HEAD']);
    if (addRes.exitCode !== 0) {
      throw new Error(`Failed to create git worktree: ${addRes.stderr || addRes.stdout}`);
    }

    const worktree: ActiveWorktree = {
      id: `${runId}:${agentId}`,
      runId,
      agentId,
      branchName,
      worktreePath: tempDir,
      createdAt: Date.now()
    };

    this.activeWorktrees.set(worktree.id, worktree);
    return worktree;
  }

  public async previewMerge(worktree: ActiveWorktree): Promise<MergePreviewResult> {
    // 1. Get changed files
    const diffStatRes = await this.execGit(['diff', '--stat', `HEAD..${worktree.branchName}`]);
    const diffContentRes = await this.execGit(['diff', `HEAD..${worktree.branchName}`]);
    const filesRes = await this.execGit(['diff', '--name-only', `HEAD..${worktree.branchName}`]);

    const changedFiles = filesRes.stdout
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // 2. Check if clean merge is possible
    const mergeBaseRes = await this.execGit(['merge-base', 'HEAD', worktree.branchName]);
    const hasConflict = mergeBaseRes.exitCode !== 0;

    return {
      hasConflict,
      changedFiles,
      diffStat: diffStatRes.stdout.trim(),
      diffContent: diffContentRes.stdout
    };
  }

  public async mergeWorktree(worktree: ActiveWorktree, message?: string): Promise<void> {
    const commitMsg = message ?? `Merge changes from agent ${worktree.agentId} (run: ${worktree.runId})`;
    const mergeRes = await this.execGit(['merge', '--no-ff', '-m', commitMsg, worktree.branchName]);

    if (mergeRes.exitCode !== 0) {
      throw new Error(`Git merge conflict or failure: ${mergeRes.stderr || mergeRes.stdout}`);
    }
  }

  public async removeWorktree(worktree: ActiveWorktree): Promise<void> {
    // Remove worktree
    await this.execGit(['worktree', 'remove', '--force', worktree.worktreePath]);

    // Delete temp folder if still present
    if (fs.existsSync(worktree.worktreePath)) {
      try {
        await fs.promises.rm(worktree.worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }

    // Delete ephemeral branch
    await this.execGit(['branch', '-D', worktree.branchName]);

    this.activeWorktrees.delete(worktree.id);
  }

  public async cleanupRunWorktrees(runId: string): Promise<void> {
    const matching = Array.from(this.activeWorktrees.values()).filter((w) => w.runId === runId);
    for (const wt of matching) {
      try {
        await this.removeWorktree(wt);
      } catch {
        // Keep cleaning remaining
      }
    }
  }

  public async cleanupAll(): Promise<void> {
    const all = Array.from(this.activeWorktrees.values());
    for (const wt of all) {
      try {
        await this.removeWorktree(wt);
      } catch {
        // Keep cleaning
      }
    }
  }

  public getActiveWorktrees(): readonly ActiveWorktree[] {
    return Array.from(this.activeWorktrees.values());
  }
}
