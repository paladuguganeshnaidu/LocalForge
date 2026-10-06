export interface CancellationNodeOptions {
  id: string;
  name?: string;
  timeoutMs?: number;
}

export class CancellationNode {
  public readonly id: string;
  public readonly name: string;
  private readonly controller: AbortController;
  private readonly children = new Map<string, CancellationNode>();
  private parent?: CancellationNode;
  private timeoutTimer?: NodeJS.Timeout;
  private isDisposed = false;

  constructor(options: CancellationNodeOptions, parent?: CancellationNode) {
    this.id = options.id;
    this.name = options.name ?? options.id;
    this.controller = new AbortController();
    this.parent = parent;

    if (options.timeoutMs && options.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        this.cancel(`Operation timed out after ${options.timeoutMs}ms`);
      }, options.timeoutMs);
    }

    if (parent) {
      if (parent.signal.aborted) {
        this.cancel(parent.signal.reason);
      } else {
        const onParentAbort = () => {
          this.cancel(parent.signal.reason);
        };
        parent.signal.addEventListener('abort', onParentAbort, { once: true });
      }
    }
  }

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get isCancelled(): boolean {
    return this.controller.signal.aborted;
  }

  public createChild(options: CancellationNodeOptions): CancellationNode {
    if (this.isCancelled) {
      const child = new CancellationNode(options, this);
      child.cancel(this.signal.reason);
      return child;
    }
    const child = new CancellationNode(options, this);
    this.children.set(child.id, child);
    return child;
  }

  public cancel(reason?: unknown): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    if (!this.controller.signal.aborted) {
      this.controller.abort(reason ?? new Error(`Cancelled: ${this.name}`));
    }

    for (const child of this.children.values()) {
      child.cancel(reason);
    }
  }

  public removeChild(childId: string): void {
    this.children.delete(childId);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    for (const child of this.children.values()) {
      child.dispose();
    }
    this.children.clear();

    if (this.parent) {
      this.parent.removeChild(this.id);
      this.parent = undefined;
    }
  }
}

export class CancellationTree {
  private readonly root: CancellationNode;

  constructor(rootId = 'root') {
    this.root = new CancellationNode({ id: rootId, name: 'Root Cancellation Context' });
  }

  public get rootNode(): CancellationNode {
    return this.root;
  }

  public createChild(options: CancellationNodeOptions): CancellationNode {
    return this.root.createChild(options);
  }

  public cancelAll(reason?: string): void {
    this.root.cancel(reason);
  }

  public dispose(): void {
    this.root.dispose();
  }
}
