import { ChatMessage, LocalModel, ModelProvider, ModelToolDefinition } from './modelProvider';
import { evaluateRuntimeCapabilities } from './modelCapabilities';

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    size?: number;
    modified_at?: string;
  }>;
}

interface OllamaChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

interface OllamaToolResponse {
  message?: ChatMessage;
  error?: string;
}

export class OllamaProvider implements ModelProvider {
  readonly id: string;

  constructor(private readonly baseUrl: string, id = 'ollama') {
    this.id = id;
  }

  async detect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return true;
    } catch {}
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return true;
    } catch {}
    try {
      const response = await fetch(`${this.baseUrl}/`, { signal: AbortSignal.timeout(2500) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async showModel(model: string): Promise<{ capabilities?: string[]; template?: string } | undefined> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(2500)
      });
      if (response.ok) {
        return (await response.json()) as { capabilities?: string[]; template?: string };
      }
    } catch {}
    return undefined;
  }

  async listModels(): Promise<LocalModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status} while listing models.`);
    }

    const data = await response.json() as OllamaTagsResponse;
    return (data.models ?? []).map((model) => ({
      name: model.name,
      size: model.size,
      modifiedAt: model.modified_at
    }));
  }

  async streamChat(
    model: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama chat failed (${response.status}): ${detail || response.statusText}`);
    }
    if (!response.body) {
      throw new Error('Ollama returned an empty response stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as OllamaChatChunk;
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.message?.content) onToken(chunk.message.content);
        } catch (e: any) {
          if (e.message && !e.message.includes('JSON') && !e.message.includes('Unexpected')) throw e;
        }
      }
      if (done) break;
    }
    if (pending.trim()) {
      try {
        const chunk = JSON.parse(pending) as OllamaChatChunk;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) onToken(chunk.message.content);
      } catch (e: any) {
        if (e.message && !e.message.includes('JSON') && !e.message.includes('Unexpected')) throw e;
      }
    }
  }

  async chatWithTools(model: string, messages: ChatMessage[], tools: ModelToolDefinition[], signal?: AbortSignal): Promise<ChatMessage> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, stream: false }),
        signal
      });
      if (response.ok) {
        const data = await response.json() as OllamaToolResponse;
        if (data.error) throw new Error(data.error);
        if (data.message && typeof data.message.content === 'string') {
          return data.message;
        }
      }
    } catch (err: any) {
      if (signal?.aborted) throw err;
      // If error indicates tools are unsupported by this model, fallback to standard chat
    }

    // Fallback: standard chat without native tools parameter (model will use LocalForge text-tool protocol)
    const fallbackResponse = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal
    });
    if (!fallbackResponse.ok) {
      const detail = await fallbackResponse.text();
      throw new Error(`Ollama request failed (${fallbackResponse.status}): ${detail || fallbackResponse.statusText}`);
    }
    const fallbackData = await fallbackResponse.json() as OllamaToolResponse;
    if (fallbackData.error) throw new Error(fallbackData.error);
    if (!fallbackData.message || typeof fallbackData.message.content !== 'string') {
      throw new Error('Ollama returned an invalid response.');
    }
    return fallbackData.message;
  }
}
