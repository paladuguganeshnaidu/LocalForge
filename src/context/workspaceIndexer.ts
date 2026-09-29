import * as vscode from 'vscode';
import { IndexedDocument } from './retrieval';

const maxFileSizeBytes = 256 * 1024;
const maxIndexedFiles = 500;

export class WorkspaceIndexer implements vscode.Disposable {
  private indexed = new Map<string, IndexedDocument>();
  private isScanning = false;
  private lastIndexedTime?: Date;
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];

  async indexWorkspace(token?: vscode.CancellationToken): Promise<number> {
    if (this.isScanning) return this.indexed.size;
    this.isScanning = true;

    try {
      const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/coverage/**,**/*.min.js,**/*.map,**/*.png,**/*.jpg,**/*.jpeg,**/*.gif,**/*.ico,**/*.svg,**/*.lock,**/package-lock.json}';
      const uris = await vscode.workspace.findFiles('**/*', excludePattern, maxIndexedFiles, token);

      for (const uri of uris) {
        if (token?.isCancellationRequested) break;
        await this.indexFile(uri);
      }

      this.lastIndexedTime = new Date();
      return this.indexed.size;
    } finally {
      this.isScanning = false;
    }
  }

  public startWatching(): void {
    if (this.watcher) return;
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
      this.disposables.push(
        this.watcher.onDidCreate((uri) => {
          void this.indexFile(uri);
        }),
        this.watcher.onDidChange((uri) => {
          void this.indexFile(uri);
        }),
        this.watcher.onDidDelete((uri) => {
          this.removeFile(uri);
        }),
        this.watcher
      );
    } catch {}
  }

  async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > maxFileSizeBytes) return;

      const bytes = await vscode.workspace.fs.readFile(uri);
      // Check for null bytes (binary files)
      if (bytes.includes(0)) return;

      const content = new TextDecoder().decode(bytes);
      const path = vscode.workspace.asRelativePath(uri);
      const lines = content.split(/\r?\n/);

      this.indexed.set(uri.toString(), {
        uri: uri.toString(),
        path,
        content,
        lines
      });
    } catch {
      // Ignore unreadable or deleted files
      this.indexed.delete(uri.toString());
    }
  }

  removeFile(uri: vscode.Uri): void {
    this.indexed.delete(uri.toString());
  }

  getDocuments(): IndexedDocument[] {
    return Array.from(this.indexed.values());
  }

  getStats(): { fileCount: number; totalChars: number; lastIndexed?: Date } {
    const totalChars = Array.from(this.indexed.values()).reduce((sum, doc) => sum + doc.content.length, 0);
    return {
      fileCount: this.indexed.size,
      totalChars,
      lastIndexed: this.lastIndexedTime
    };
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.watcher = undefined;
    this.indexed.clear();
  }
}

