import * as vscode from 'vscode';
import { createHash } from 'node:crypto';
import { IndexedDocument, createDocumentChunks, LexicalRetrievalEngine, RetrievalOptions, SearchMatch } from './retrieval';
import { WorkspaceIndexRules, workspaceIndexExclusions } from './workspaceIndexRules';

export interface WorkspaceIndexLimits { maxFiles: number; maxFileBytes: number; maxCharacters: number; candidateFiles: number }
export interface WorkspaceIndexStatus {
  state: 'idle' | 'indexing' | 'updating' | 'ready' | 'disabled' | 'error' | 'disposed';
  fileCount: number;
  chunkCount: number;
  totalChars: number;
  lastIndexed?: Date;
  error?: string;
  limitReached: boolean;
  watching: boolean;
  generation: number;
  limits: WorkspaceIndexLimits;
}
export function readWorkspaceIndexLimits(): WorkspaceIndexLimits {
  const configuration = vscode.workspace.getConfiguration?.('localforge.context');
  const bounded = (key: string, fallback: number, minimum: number, maximum: number): number => {
    const value = configuration?.get<number>(key, fallback);
    return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value!)) : fallback;
  };
  const maxFiles = bounded('maxIndexedFiles', 2000, 1, 20000);
  return { maxFiles, maxFileBytes: bounded('maxFileBytes', 262144, 1024, 8388608), maxCharacters: bounded('maxIndexCharacters', 8000000, 100000, 64000000), candidateFiles: Math.min(100000, Math.max(2048, maxFiles * 8)) };
}

export class WorkspaceIndexer implements vscode.Disposable {
  private indexed = new Map<string, IndexedDocument>();
  private queue: Promise<void> = Promise.resolve();
  private rebuild?: Promise<number>;
  private initialized = false;
  private rulesLoaded = false;
  private disposed = false;
  private generation = 0;
  private lastIndexedTime?: Date;
  private state: WorkspaceIndexStatus['state'] = 'idle';
  private error?: string;
  private fileErrors = new Map<string, string>();
  private limitReached = false;
  private watcher?: vscode.FileSystemWatcher;
  private disposables: vscode.Disposable[] = [];
  private listeners = new Set<(status: WorkspaceIndexStatus) => void>();
  private pending = new Map<string, vscode.Uri>();
  private debounce?: NodeJS.Timeout;
  private rules = new WorkspaceIndexRules();
  private retrieval = new LexicalRetrievalEngine();

  onDidChange(listener: (status: WorkspaceIndexStatus) => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  indexWorkspace(token?: vscode.CancellationToken): Promise<number> {
    if (this.disposed) return Promise.reject(new Error('The workspace index was disposed.'));
    if (token?.isCancellationRequested) return Promise.reject(new vscode.CancellationError());
    if (this.rebuild) return this.rebuild;
    const rebuild = this.enqueue(async () => {
      this.checkCancellation(token);
      if (!vscode.workspace.isTrusted) { this.disable(); return 0; }
      this.state = 'indexing'; this.error = undefined; this.fileErrors.clear(); this.publish();
      const replacement = new Map<string, IndexedDocument>();
      const limits = readWorkspaceIndexLimits();
      let characters = 0;
      let limited = false;
      try {
        await this.rules.load();
        this.rulesLoaded = true;
        const targets = await vscode.workspace.findFiles('**/*', workspaceIndexExclusions, limits.candidateFiles + 1, token);
        limited = targets.length > limits.candidateFiles;
        for (const [position, uri] of targets.slice(0, limits.candidateFiles).entries()) {
          this.checkCancellation(token);
          if (position % 25 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
          const document = await this.readDocument(uri, limits);
          if (!document) continue;
          if (replacement.size >= limits.maxFiles || characters + document.content.length > limits.maxCharacters) { limited = true; continue; }
          replacement.set(uri.toString(), document);
          characters += document.content.length;
        }
        this.checkCancellation(token);
        if (!vscode.workspace.isTrusted) { this.disable(); return 0; }
        this.indexed = replacement;
        this.initialized = true; this.limitReached = limited;
        this.generation += 1; this.lastIndexedTime = new Date();
        this.state = this.currentError() ? 'error' : 'ready'; this.publish();
        return this.indexed.size;
      } catch (error) {
        if (!this.disposed) {
          this.state = token?.isCancellationRequested ? this.initialized ? 'ready' : 'idle' : 'error';
          if (!token?.isCancellationRequested) this.error = this.describeError(error);
          this.publish();
        }
        throw error;
      }
    });
    this.rebuild = rebuild;
    void rebuild.finally(() => { if (this.rebuild === rebuild) this.rebuild = undefined; }).catch(() => {});
    return rebuild;
  }

  startWatching(): void {
    if (this.watcher || this.disposed) return;
    try {
      this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
      this.disposables.push(this.watcher.onDidCreate((uri) => this.schedule(uri)), this.watcher.onDidChange((uri) => this.schedule(uri)), this.watcher.onDidDelete((uri) => this.schedule(uri)), this.watcher);
      if (vscode.workspace.onDidChangeConfiguration) this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (['localforge.context', 'files.exclude', 'search.exclude'].some((section) => event.affectsConfiguration(section))) this.requestRebuild();
      }));
      if (vscode.workspace.onDidChangeWorkspaceFolders) this.disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.requestRebuild()));
      if (vscode.workspace.onDidGrantWorkspaceTrust) this.disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.requestRebuild()));
      this.publish();
    } catch (error) { this.error = this.describeError(error); this.state = 'error'; this.publish(); }
  }

  private requestRebuild(): void {
    void (async () => { if (this.rebuild) await this.rebuild.catch(() => {}); if (!this.disposed) await this.indexWorkspace(); })().catch(() => {});
  }

  private schedule(uri: vscode.Uri): void {
    if (this.disposed) return;
    this.pending.set(uri.toString(), uri);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = undefined; void this.whenIdle().catch((error) => { if (!this.disposed) { this.error = this.describeError(error); this.state = 'error'; this.publish(); } }); }, 120);
  }

  async whenIdle(): Promise<void> {
    if (this.disposed) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
    while (!this.disposed) {
      const pending = [...this.pending.values()];
      this.pending.clear();
      if (pending.some((uri) => /(?:^|\/)\.(?:gitignore|ignore)$/.test(uri.path))) {
        if (this.rebuild) await this.rebuild;
        await this.indexWorkspace();
      } else if (pending.length) await this.enqueue(async () => {
        this.state = 'updating'; this.publish();
        await this.ensureRules();
        for (const uri of pending) await this.updateDocument(uri);
        if (!this.disposed) { this.state = this.currentError() ? 'error' : 'ready'; this.publish(); }
      });
      const queue = this.queue;
      await queue;
      if (queue === this.queue && !this.pending.size) return;
    }
  }

  async ensureReady(): Promise<void> {
    if (!this.initialized && !this.disposed) await this.indexWorkspace();
    await this.whenIdle();
    if (this.currentError()) throw new Error('Workspace index needs attention: ' + this.currentError());
  }

  indexFile(uri: vscode.Uri): Promise<void> {
    return this.enqueue(async () => { await this.ensureRules(); await this.updateDocument(uri); if (!this.disposed) { this.state = this.currentError() ? 'error' : 'ready'; this.publish(); } });
  }
  async search(query: string, options?: RetrievalOptions): Promise<SearchMatch[]> {
    await this.ensureReady();
    const results = await this.retrieval.retrieve(query, this.getDocuments(), options);
    const verified: SearchMatch[] = [];
    for (const match of results) if (await this.isCurrent(match)) verified.push(match);
    return verified;
  }
  async isCurrent(match: SearchMatch): Promise<boolean> {
    const uri = vscode.Uri.parse(match.uri);
    try {
      if (!await this.rules.allows(uri) || this.indexed.get(match.uri)?.hash !== match.fileHash) return false;
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > readWorkspaceIndexLimits().maxFileBytes) return false;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (createHash('sha256').update(bytes).digest('hex') === match.fileHash) return true;
    } catch {}
    await this.indexFile(uri);
    return false;
  }
  notifyFilesChanged(uris: vscode.Uri[]): void { for (const uri of uris) this.schedule(uri); }
  removeFile(uri: vscode.Uri): void { this.schedule(uri); }
  private async ensureRules(): Promise<void> { if (!this.rulesLoaded) { await this.rules.load(); this.rulesLoaded = true; } }

  private async updateDocument(uri: vscode.Uri): Promise<void> {
    if (this.disposed) return;
    if (!vscode.workspace.isTrusted) { this.disable(); return; }
    const limits = readWorkspaceIndexLimits();
    const document = await this.readDocument(uri, limits);
    if (this.disposed) return;
    this.indexed.delete(uri.toString());
    if (document) {
      const characters = [...this.indexed.values()].reduce((total, item) => total + item.content.length, 0);
      if (this.indexed.size < limits.maxFiles && characters + document.content.length <= limits.maxCharacters) this.indexed.set(uri.toString(), document);
      else this.limitReached = true;
    }
    this.generation += 1; this.lastIndexedTime = new Date();
  }

  private async readDocument(uri: vscode.Uri, limits: WorkspaceIndexLimits): Promise<IndexedDocument | undefined> {
    this.fileErrors.delete(uri.toString());
    try {
      if (this.disposed || !await this.rules.allows(uri)) return undefined;
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > limits.maxFileBytes) return undefined;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.length > limits.maxFileBytes || bytes.includes(0)) return undefined;
      const after = await vscode.workspace.fs.stat(uri);
      if (after.size !== stat.size || after.mtime !== stat.mtime) { this.schedule(uri); return undefined; }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const document: IndexedDocument = { uri: uri.toString(), path: vscode.workspace.asRelativePath(uri), content, lines: content.split(/\r?\n/), hash: createHash('sha256').update(bytes).digest('hex'), mtime: stat.mtime, language: uri.path.split('.').at(-1)?.toLowerCase() ?? 'text' };
      document.chunks = createDocumentChunks(document);
      return document;
    } catch (error) {
      if (!['ENOENT', 'FileNotFound', 'ERR_ENCODING_INVALID_ENCODED_DATA'].includes((error as { code?: string }).code ?? '') && this.fileErrors.size < 100) this.fileErrors.set(uri.toString(), this.describeError(error));
      return undefined;
    }
  }

  getDocuments(): IndexedDocument[] {
    if (!vscode.workspace.isTrusted) return [];
    return [...this.indexed.values()].map((document) => ({ ...document, lines: [...document.lines], chunks: document.chunks?.map((chunk) => ({ ...chunk })) }));
  }
  getStats(): WorkspaceIndexStatus {
    const documents = vscode.workspace.isTrusted ? [...this.indexed.values()] : [];
    return { state: this.state, fileCount: documents.length, chunkCount: documents.reduce((total, document) => total + (document.chunks?.length ?? 0), 0), totalChars: documents.reduce((total, document) => total + document.content.length, 0), lastIndexed: this.lastIndexedTime && new Date(this.lastIndexedTime), error: this.currentError(), limitReached: this.limitReached, watching: !!this.watcher && !this.disposed, generation: this.generation, limits: readWorkspaceIndexLimits() };
  }
  private enqueue<Result>(action: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(async () => { if (this.disposed) throw new Error('The workspace index was disposed.'); return action(); });
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  private checkCancellation(token?: vscode.CancellationToken): void {
    if (this.disposed) throw new Error('The workspace index was disposed.');
    if (token?.isCancellationRequested) throw new vscode.CancellationError();
  }
  private currentError(): string | undefined { return this.error ?? this.fileErrors.values().next().value; }
  private describeError(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 800); }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(this.getStats()); }
  private disable(): void { this.indexed.clear(); this.initialized = false; this.state = 'disabled'; this.generation += 1; this.publish(); }
  dispose(): void {
    this.disposed = true;
    if (this.debounce) clearTimeout(this.debounce);
    this.pending.clear();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = []; this.watcher = undefined; this.indexed.clear(); this.listeners.clear(); this.state = 'disposed';
  }
}
