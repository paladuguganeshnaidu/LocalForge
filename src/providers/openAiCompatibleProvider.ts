import { ChatMessage, LocalModel, ModelProvider, ModelToolDefinition } from './modelProvider';

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

interface CompletionChunk {
  choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }>;
  error?: { message?: string };
}

interface ToolResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }>;
    };
  }>;
  error?: { message?: string };
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly baseUrl: string;

  constructor(id: string, baseUrl: string) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async detect(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(1000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LocalModel[]> {
    const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error(`${this.id} returned HTTP ${response.status} while listing models.`);
    const data = await response.json() as ModelsResponse;
    return (data.data ?? []).flatMap((model) => model.id ? [{ name: model.id }] : []);
  }

  async streamChat(model: string, messages: ChatMessage[], onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${this.id} chat failed (${response.status}): ${detail || response.statusText}`);
    }
    if (!response.body) throw new Error(`${this.id} returned an empty response stream.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) await consumeSseLine(line, onToken);
      if (done) break;
    }
    if (pending.trim()) await consumeSseLine(pending, onToken);
  }

  async chatWithTools(model: string, messages: ChatMessage[], tools: ModelToolDefinition[], signal?: AbortSignal): Promise<ChatMessage> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false }),
      signal
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${this.id} agent request failed (${response.status}): ${detail || response.statusText}`);
    }
    const data = await response.json() as ToolResponse;
    if (data.error) throw new Error(data.error.message || `${this.id} returned an agent error.`);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`${this.id} returned an invalid tool-call response.`);
    const toolCalls = (message.tool_calls ?? []).flatMap((call) => {
      if (!call.function?.name) return [];
      return [{
        id: call.id,
        type: 'function' as const,
        function: { name: call.function.name, arguments: call.function.arguments ?? '{}' }
      }];
    });
    return { role: 'assistant', content: message.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  }
}

async function consumeSseLine(line: string, onToken: (token: string) => void): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === '[DONE]') return;
  let chunk: CompletionChunk;
  try {
    chunk = JSON.parse(data) as CompletionChunk;
  } catch {
    throw new Error('The OpenAI-compatible server returned malformed streaming data.');
  }
  if (chunk.error) throw new Error(chunk.error.message || 'The OpenAI-compatible server returned an error.');
  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string') onToken(content);
  else if (Array.isArray(content)) for (const item of content) if (item.text) onToken(item.text);
}
