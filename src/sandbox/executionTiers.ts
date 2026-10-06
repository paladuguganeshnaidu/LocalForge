export type ExecutionTier =
  | 'read_only'
  | 'workspace_host'
  | 'isolated_worktree'
  | 'container_sandbox'
  | 'remote_runner';

export interface TierCapabilities {
  tier: ExecutionTier;
  allowFilesystemWrite: boolean;
  allowHostTerminal: boolean;
  allowNetworkEgress: boolean;
  requiresIsolation: boolean;
  description: string;
}

export const TIER_CAPABILITIES: Record<ExecutionTier, TierCapabilities> = {
  read_only: {
    tier: 'read_only',
    allowFilesystemWrite: false,
    allowHostTerminal: false,
    allowNetworkEgress: false,
    requiresIsolation: false,
    description: 'Read-only inspection mode. Zero modifications or terminal executions permitted.'
  },
  workspace_host: {
    tier: 'workspace_host',
    allowFilesystemWrite: true,
    allowHostTerminal: true,
    allowNetworkEgress: true,
    requiresIsolation: false,
    description: 'Direct workspace host execution with user authorization gates.'
  },
  isolated_worktree: {
    tier: 'isolated_worktree',
    allowFilesystemWrite: true,
    allowHostTerminal: true,
    allowNetworkEgress: true,
    requiresIsolation: true,
    description: 'Isolated ephemeral Git worktree. Primary branch remains untouched until verified merge.'
  },
  container_sandbox: {
    tier: 'container_sandbox',
    allowFilesystemWrite: true,
    allowHostTerminal: true,
    allowNetworkEgress: false,
    requiresIsolation: true,
    description: 'OS-sandboxed container execution with restricted network and filtered filesystem mounts.'
  },
  remote_runner: {
    tier: 'remote_runner',
    allowFilesystemWrite: true,
    allowHostTerminal: true,
    allowNetworkEgress: true,
    requiresIsolation: true,
    description: 'Delegated execution to self-hosted background runner daemon.'
  }
};

export class ExecutionTierManager {
  private currentTier: ExecutionTier = 'workspace_host';

  constructor(defaultTier: ExecutionTier = 'workspace_host') {
    this.currentTier = defaultTier;
  }

  public getTier(): ExecutionTier {
    return this.currentTier;
  }

  public setTier(tier: ExecutionTier): void {
    this.currentTier = tier;
  }

  public getCapabilities(): TierCapabilities {
    return TIER_CAPABILITIES[this.currentTier];
  }

  public canMutateFilesystem(): boolean {
    return this.getCapabilities().allowFilesystemWrite;
  }

  public canExecuteTerminal(): boolean {
    return this.getCapabilities().allowHostTerminal;
  }
}
