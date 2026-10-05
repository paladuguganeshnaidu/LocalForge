import { LocalModel, ModelProvider } from './modelProvider';
import { inferModelCapabilities, evaluateRuntimeCapabilities, ModelCapabilities, ModelMetadata, ModelSource } from './modelCapabilities';
import { ModelTask } from './modelRouter';
import { canonicalModelId } from './endpointConfiguration';

export interface ProviderHealth {
  id: string;
  source: ModelSource;
  endpoint: string;
  isReachable: boolean;
  healthy?: boolean;
  modelCount: number;
  gpuInfo?: string;
  lastChecked: Date;
  error?: string;
}

export class ModelRegistry {
  private providers = new Map<string, { provider: ModelProvider; source: ModelSource; endpoint?: string; gpuInfo?: string }>();
  private models = new Map<string, ModelMetadata>();
  private health = new Map<string, ProviderHealth>();
  private revision = 0;
  private discovery = 0;
  private pendingDiscovery?: { revision: number; promise: Promise<ModelMetadata[]> };

  registerProvider(provider: ModelProvider, source: ModelSource = provider.source ?? 'local', endpoint?: string, gpuInfo?: string): void {
    if (this.providers.get(provider.id)?.provider !== provider) this.unregisterProvider(provider.id);
    this.providers.set(provider.id, { provider, source, endpoint, gpuInfo });
    this.revision += 1;
  }

  unregisterProvider(providerId: string): void {
    this.revision += 1;
    this.providers.delete(providerId);
    this.health.delete(providerId);
    for (const [id, model] of this.models.entries()) {
      if (model.providerId === providerId) {
        this.models.delete(id);
      }
    }
  }

  getProvider(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId)?.provider;
  }

  getAllProviders(): ModelProvider[] {
    return Array.from(this.providers.values()).map((p) => p.provider);
  }

  getProviders(): Array<{ id: string; endpoint?: string; healthy?: boolean }> {
    return Array.from(this.providers.entries()).map(([id, entry]) => {
      const h = this.health.get(id);
      return {
        id,
        endpoint: entry.endpoint,
        healthy: h ? h.isReachable : undefined
      };
    });
  }

  async discoverAll(): Promise<ModelMetadata[]> {
    if (this.pendingDiscovery?.revision === this.revision) return this.pendingDiscovery.promise;
    const pending = { revision: this.revision, promise: this.discoverSnapshot() };
    this.pendingDiscovery = pending;
    try { return await pending.promise; }
    finally { if (this.pendingDiscovery === pending) this.pendingDiscovery = undefined; }
  }

  private async discoverSnapshot(): Promise<ModelMetadata[]> {
    const revision = this.revision;
    const discovery = ++this.discovery;
    const replacementModels = new Map<string, ModelMetadata>();
    const replacementHealth = new Map<string, ProviderHealth>();
    const probeResults = await Promise.allSettled(
      Array.from(this.providers.entries()).map(async ([providerId, entry]) => {
        let isReachable = false;
        let models: LocalModel[] = [];
        let errStr: string | undefined;

        try {
          isReachable = entry.provider.detect ? await entry.provider.detect() : true;
          if (isReachable) {
            models = await entry.provider.listModels();
          } else errStr = 'Endpoint did not respond successfully to model discovery.';
        } catch (error) {
          isReachable = false;
          errStr = (error instanceof Error ? error.message : String(error)).slice(0, 800);
        }

        const health: ProviderHealth = {
          id: providerId,
          source: entry.source,
          endpoint: entry.endpoint || '',
          isReachable,
          healthy: isReachable,
          modelCount: models.length,
          gpuInfo: entry.gpuInfo,
          lastChecked: new Date(),
          error: errStr
        };
        replacementHealth.set(providerId, health);

        return { providerId, entry, models };
      })
    );

    for (const res of probeResults) {
      if (res.status !== 'fulfilled') continue;
      const { providerId, entry, models } = res.value;
      for (const m of models) {
        const id = canonicalModelId(providerId, m.name);
        let runtimeCaps: { capabilities?: string[]; template?: string; model_info?: Record<string, unknown> } | undefined;
        if (typeof (entry.provider as any).showModel === 'function') {
          try {
            runtimeCaps = await (entry.provider as any).showModel(m.name);
          } catch {}
        }
        const capabilities = m.capabilities || evaluateRuntimeCapabilities(m.name, m.size, runtimeCaps);
        const displayName = m.displayName || `${m.name} (${providerId.startsWith('openai-') && entry.endpoint ? entry.endpoint : entry.source === 'remote' ? 'Remote GPU' : providerId})`;

        const metadata: ModelMetadata = {
          id,
          name: m.name,
          displayName,
          providerId,
          source: entry.source,
          size: m.size,
          modifiedAt: m.modifiedAt,
          capabilities,
          endpoint: entry.endpoint,
          gpuInfo: entry.gpuInfo
        };
        replacementModels.set(id, metadata);
      }
    }

    if (revision === this.revision && discovery === this.discovery) {
      this.models = replacementModels;
      this.health = replacementHealth;
    }
    return this.getModels();
  }

  async refresh(): Promise<ModelMetadata[]> {
    return this.discoverAll();
  }

  getModels(): ModelMetadata[] {
    return Array.from(this.models.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  getAllModels(): ModelMetadata[] {
    return this.getModels();
  }

  getModel(id: string): ModelMetadata | undefined {
    return this.models.get(id);
  }

  getHealthReport(): ProviderHealth[] {
    return Array.from(this.health.values());
  }

  filterByCapability(predicate: (caps: ModelCapabilities) => boolean): ModelMetadata[] {
    return this.getModels().filter((m) => predicate(m.capabilities));
  }

  findModelForTask(task: ModelTask, preference?: string): ModelMetadata | undefined {
    const all = this.getModels();
    if (!all.length) return undefined;

    // 1. Exact preference match
    if (preference) {
      const match = all.find((m) => m.id === preference || m.name === preference || m.displayName === preference);
      if (match) return match;
    }

    // 2. Task capability requirements
    if (task === 'agent') {
      const toolModels = all.filter((m) => m.capabilities.toolCalling);
      if (toolModels.length) return toolModels[0];
    }

    if (task === 'completion') {
      const coderModels = all.filter((m) => m.capabilities.codeCompletion);
      if (coderModels.length) {
        return coderModels.sort((a, b) => (a.size || 0) - (b.size || 0))[0];
      }
    }

    // 3. Fallback to first available
    return all[0];
  }
}
