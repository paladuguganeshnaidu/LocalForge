import { ModelRegistry } from './modelRegistry';
import { ModelProvider } from './modelProvider';
import { OllamaProvider } from './ollamaProvider';
import { OpenAiCompatibleProvider } from './openAiCompatibleProvider';
import { compatibleProviderId, EndpointConfiguration, normalizeEndpoint, parseCompatibleEndpoints } from './endpointConfiguration';

export class ConfiguredProviders {
  private managed = new Map<string, { endpoint: string; provider: ModelProvider }>();
  private errors: string[] = [];

  constructor(private readonly registry: ModelRegistry, private readonly generationOptions: () => { num_ctx: number; num_predict: number; temperature: number; thinking?: boolean }) {}

  configure(configuration: EndpointConfiguration): void {
    const compatible = parseCompatibleEndpoints(configuration.openAiEndpoints ?? configuration.openAiEndpoint ?? '');
    const errors = [...compatible.errors];
    const desired = new Map<string, string>(compatible.endpoints.map((endpoint) => [compatibleProviderId(endpoint), endpoint]));
    try { desired.set('ollama', normalizeEndpoint(configuration.ollamaEndpoint ?? 'http://127.0.0.1:11434')); }
    catch { errors.push('Ollama endpoint is invalid. Use HTTP(S) without credentials, query parameters or fragments.'); }
    for (const [id, current] of this.managed) if (desired.get(id) !== current.endpoint) { this.registry.unregisterProvider(id); this.managed.delete(id); }
    for (const [id, endpoint] of desired) {
      if (this.managed.has(id)) continue;
      const provider = id === 'ollama' ? new OllamaProvider(endpoint, id, this.generationOptions) : new OpenAiCompatibleProvider(id, endpoint);
      this.managed.set(id, { endpoint, provider });
      this.registry.registerProvider(provider, provider.source, endpoint);
    }
    this.errors = errors;
  }

  getErrors(): string[] { return [...this.errors]; }
}
