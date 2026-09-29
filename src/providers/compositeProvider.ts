import { ChatMessage, LocalModel, ModelProvider, ModelToolDefinition } from './modelProvider';
import { inferModelCapabilities } from './modelCapabilities';

export class CompositeProvider implements ModelProvider {
  readonly id = 'localforge';
  private providers: ModelProvider[];
  private discovered = new Map<string, { provider: ModelProvider; actualName: string }>();

  constructor(providers: ModelProvider[]) {
    this.providers = providers;
  }

  async detect(): Promise<boolean> {
    const results = await Promise.allSettled(this.providers.map((provider) => provider.detect()));
    return results.some((result) => result.status === 'fulfilled' && result.value);
  }

  async listModels(): Promise<LocalModel[]> {
    this.discovered.clear();
    const result = await Promise.allSettled(this.providers.map(async (provider) => ({
      provider,
      models: await provider.listModels()
    })));
    const output: LocalModel[] = [];
    for (const item of result) {
      if (item.status !== 'fulfilled') continue;
      for (const model of item.value.models) {
        const key = `${item.value.provider.id}:${encodeURIComponent(model.name)}`;
        const unencodedKey = `${item.value.provider.id}:${model.name}`;
        this.discovered.set(key, { provider: item.value.provider, actualName: model.name });
        this.discovered.set(unencodedKey, { provider: item.value.provider, actualName: model.name });
        this.discovered.set(model.name, { provider: item.value.provider, actualName: model.name });
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
    return output.sort((left, right) => (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name));
  }

  public resolveProvider(model: string): { provider: ModelProvider; actualName: string } | undefined {
    return this.resolveRoute(model);
  }

  public resolveRoute(model: string): { provider: ModelProvider; actualName: string } | undefined {
    if (!model) return undefined;
    let route = this.discovered.get(model);
    if (route) return route;

    // Check decoded
    try {
      const decoded = decodeURIComponent(model);
      route = this.discovered.get(decoded);
      if (route) return route;
    } catch {}

    // Check re-encoded
    try {
      const parts = model.split(':');
      if (parts.length > 2) {
        const encoded = `${parts[0]}:${encodeURIComponent(parts.slice(1).join(':'))}`;
        route = this.discovered.get(encoded);
        if (route) return route;
      }
    } catch {}

    // Strip provider prefix if present e.g. "ollama:qwen2.5-coder:1.5b" -> "qwen2.5-coder:1.5b"
    const stripped = model.replace(/^[a-zA-Z0-9_-]+:/, '');
    route = this.discovered.get(stripped);
    if (route) return route;

    try {
      const decodedStripped = decodeURIComponent(stripped);
      route = this.discovered.get(decodedStripped);
      if (route) return route;
    } catch {}

    // Check if matches actualName
    for (const entry of this.discovered.values()) {
      if (entry.actualName === model || entry.actualName === stripped) return entry;
    }

    return undefined;
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

  async chatWithTools(model: string, messages: ChatMessage[], tools: ModelToolDefinition[], signal?: AbortSignal): Promise<ChatMessage> {
    let route = this.resolveRoute(model);
    if (!route) {
      await this.listModels();
      route = this.resolveRoute(model);
    }
    if (!route) throw new Error('The selected model is no longer available. Refresh the model list and try again.');
    if (!route.provider.chatWithTools) throw new Error(`Provider ${route.provider.id} does not support agent tool calls.`);
    return route.provider.chatWithTools(route.actualName, messages, tools, signal);
  }

  addProvider(provider: ModelProvider): void {
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
    this.providers = this.providers.filter((provider) => provider.id !== providerId);
    for (const [key, route] of this.discovered) if (route.provider.id === providerId) this.discovered.delete(key);
  }

  unregisterProvider(providerId: string): void {
    this.removeProvider(providerId);
  }

  getProviders(): ModelProvider[] {
    return [...this.providers];
  }
}
