import { ChatMessage, LocalModel, ModelProvider, ModelPullProgress, ModelToolDefinition, ModelGenerationProgress } from './modelProvider';
import { inferModelCapabilities } from './modelCapabilities';
import { ModelRegistry } from './modelRegistry';
import { canonicalModelId } from './endpointConfiguration';

export class CompositeProvider implements ModelProvider {
  readonly id = 'tuxnest';
  private providers: ModelProvider[];
  private discovered: Array<{ provider: ModelProvider; model: LocalModel }> = [];
  private revision = 0;
  private discovery = 0;

  constructor(providers: ModelProvider[], private readonly registry?: ModelRegistry) {
    this.providers = [...providers];
    for (const provider of providers) this.registry?.registerProvider(provider);
  }

  async detect(): Promise<boolean> {
    const results = await Promise.allSettled(this.getProviders().map((provider) => provider.detect()));
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }

  async listModels(): Promise<LocalModel[]> {
    if (this.registry) {
      await this.registry.refresh();
      return this.registry.getModels().map((model) => ({ ...model, name: model.id }));
    }
    const revision = this.revision;
    const discovery = ++this.discovery;
    const replacement: typeof this.discovered = [];
    const result = await Promise.allSettled(this.getProviders().map(async (provider) => ({
      provider,
      models: await provider.listModels()
    })));
    const output: LocalModel[] = [];
    for (const item of result) {
      if (item.status !== 'fulfilled') continue;
      for (const model of item.value.models) {
        const key = canonicalModelId(item.value.provider.id, model.name);
        replacement.push({ provider: item.value.provider, model });
        const capabilities = model.capabilities ?? inferModelCapabilities(model.name, model.size);
        output.push({
          ...model,
          id: key,
          name: key,
          displayName: `${model.name} · ${item.value.provider.id}`,
          providerId: item.value.provider.id,
          capabilities
        });
      }
    }
    if (revision !== this.revision || discovery !== this.discovery) return this.discovered.map(({ model, provider }) => ({ ...model, id: canonicalModelId(provider.id, model.name), name: canonicalModelId(provider.id, model.name), providerId: provider.id }));
    this.discovered = replacement;
    return output.sort((left, right) => (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name));
  }

  async pullModel(name: string, onProgress: (progress: ModelPullProgress) => void, signal?: AbortSignal): Promise<void> {
    const ollama = this.getProviders().find((provider) => provider.id === 'ollama' &&
      (!provider.source || provider.source === 'local') && provider.pullModel);
    if (!ollama?.pullModel) {
      throw new Error('Model downloads are available when a local Ollama provider is configured and running.');
    }
    await ollama.pullModel(name, onProgress, signal);
  }

  async getDownloadTargets(): Promise<Array<{ id: string; label: string; source?: ModelProvider['source'] }>> {
    const results = await Promise.all(this.getProviders().filter(provider => provider.pullModel).map(async provider => {
      try {
        if (!await provider.detect()) return undefined;
        return { id: provider.id, label: provider.source === 'remote' ? `SSH host · ${provider.id}` : `This machine · ${provider.id}`, source: provider.source };
      } catch { return undefined; }
    }));
    return results.filter((target): target is NonNullable<typeof target> => !!target);
  }

  async pullModelToProvider(providerId: string, name: string, onProgress: (progress: ModelPullProgress) => void, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const provider = this.getProviders().find(candidate => candidate.id === providerId);
    if (!provider?.pullModel || !await provider.detect()) throw new Error('The selected download host is unavailable. Reconnect it; no other host was used.');
    signal?.throwIfAborted();
    if (!this.getProviders().includes(provider)) throw new Error('The selected download host disconnected. No other host was used.');
    await provider.pullModel(name, onProgress, signal);
  }

  async deleteModel(modelId: string, signal?: AbortSignal): Promise<void> {
    const installed = (await this.listModels()).find((model) => model.id === modelId || model.name === modelId);
    const route = installed ? this.resolveRoute(installed.id || installed.name) : undefined;
    if (!route || (installed?.source && installed.source !== 'local') ||
        (route.provider.source && route.provider.source !== 'local') || route.provider.id !== 'ollama' || !route.provider.deleteModel) {
      throw new Error('Only installed models from the configured local Ollama provider can be deleted here.');
    }
    await route.provider.deleteModel(route.actualName, signal);
  }

  public resolveProvider(model: string): { provider: ModelProvider; actualName: string } | undefined {
    return this.resolveRoute(model);
  }

  public resolveRoute(model: string): { provider: ModelProvider; actualName: string } | undefined {
    if (!model) return undefined;
    const routes = this.registry ? this.registry.getModels().flatMap((entry) => {
      const provider = this.registry!.getProvider(entry.providerId);
      return provider ? [{ provider, model: entry }] : [];
    }) : this.discovered;
    const scoped = routes.filter((entry) => canonicalModelId(entry.provider.id, entry.model.name) === model || `${entry.provider.id}:${entry.model.name}` === model);
    const matches = scoped.length ? scoped : routes.filter((entry) => entry.model.name === model);
    return matches.length === 1 ? { provider: matches[0].provider, actualName: matches[0].model.name } : undefined;
  }

  async streamChat(model: string, messages: ChatMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    let route = this.resolveRoute(model);
    if (!route) {
      await this.listModels();
      route = this.resolveRoute(model);
    }
    if (!route) throw new Error('The selected model is no longer available. Refresh the model list and try again.');
    await route.provider.streamChat(route.actualName, messages, onToken, signal);
  }

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
    onContentDelta?: (delta: string) => void,
    onGenerationProgress?: (progress: ModelGenerationProgress) => void
  ): Promise<ChatMessage> {
    let route = this.resolveRoute(model);
    if (!route) {
      await this.listModels();
      route = this.resolveRoute(model);
    }
    if (!route) throw new Error('The selected model is no longer available. Refresh the model list and try again.');
    if (!route.provider.chatWithTools) throw new Error(`Provider ${route.provider.id} does not support agent tool calls.`);
    return route.provider.chatWithTools(route.actualName, messages, tools, signal, onContentDelta, onGenerationProgress);
  }

  addProvider(provider: ModelProvider): void {
    if (this.registry) { this.registry.registerProvider(provider); return; }
    this.revision += 1;
    this.discovered = this.discovered.filter((entry) => entry.provider.id !== provider.id);
    if (this.providers.some((existing) => existing.id === provider.id)) {
      this.providers = this.providers.map((existing) => existing.id === provider.id ? provider : existing);
    } else {
      this.providers.push(provider);
    }
  }

  registerProvider(provider: ModelProvider): void {
    this.addProvider(provider);
  }

  removeProvider(providerId: string): void {
    if (this.registry) { this.registry.unregisterProvider(providerId); return; }
    this.revision += 1;
    this.providers = this.providers.filter((provider) => provider.id !== providerId);
    this.discovered = this.discovered.filter((entry) => entry.provider.id !== providerId);
  }

  unregisterProvider(providerId: string): void {
    this.removeProvider(providerId);
  }

  getProviders(): ModelProvider[] {
    return this.registry ? this.registry.getAllProviders() : [...this.providers];
  }
}
