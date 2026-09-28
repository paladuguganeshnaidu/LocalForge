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
        this.discovered.set(key, { provider: item.value.provider, actualName: model.name });
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

  async streamChat(model: string, messages: ChatMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    let route = this.discovered.get(model);
    if (!route) {
      await this.listModels();
      route = this.discovered.get(model);
    }
    if (!route) throw new Error('The selected model is no longer available. Refresh the model list and try again.');
    await route.provider.streamChat(route.actualName, messages, onToken, signal);
  }

  async chatWithTools(model: string, messages: ChatMessage[], tools: ModelToolDefinition[], signal?: AbortSignal): Promise<ChatMessage> {
    let route = this.discovered.get(model);
    if (!route) {
      await this.listModels();
      route = this.discovered.get(model);
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

  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((provider) => provider.id !== providerId);
    for (const [key, route] of this.discovered) if (route.provider.id === providerId) this.discovered.delete(key);
  }

  getProviders(): ModelProvider[] {
    return [...this.providers];
  }
}
