import { ChatMessage, LocalModel, ModelProvider } from './modelProvider';

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

export class OllamaProvider implements ModelProvider {
  readonly id = 'ollama';

  constructor(private readonly baseUrl: string) {}

  async detect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
      return response.ok;
    } catch {
      return false;
    }
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
        const chunk = JSON.parse(line) as OllamaChatChunk;
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.message?.content) onToken(chunk.message.content);
      }
      if (done) break;
    }
    if (pending.trim()) {
      const chunk = JSON.parse(pending) as OllamaChatChunk;
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.content) onToken(chunk.message.content);
    }
  }
}
