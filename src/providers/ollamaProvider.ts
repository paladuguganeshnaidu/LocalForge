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
  message?: { content?: string; tool_calls?: ChatMessage['tool_calls'] };
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

  private formatMessagesForOllama(messages: ChatMessage[]): any[] {
    return messages.map((m) => {
      const formatted: any = {
        role: m.role,
        content: m.content || ''
      };
      if (m.name) formatted.name = m.name;
      if (m.tool_call_id) formatted.tool_call_id = m.tool_call_id;
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        formatted.tool_calls = m.tool_calls.map((tc) => {
          let args = tc.function?.arguments;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          return {
            id: tc.id,
            type: tc.type || 'function',
            function: {
              name: tc.function?.name,
              arguments: (args && typeof args === 'object' && !Array.isArray(args)) ? args : {}
            }
          };
        });
      }
      return formatted;
    });
  }

  async streamChat(
    model: string,
    messages: ChatMessage[],
    onToken: (token: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const formattedMessages = this.formatMessagesForOllama(messages);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: formattedMessages, stream: true }),
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

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
    onContentDelta?: (delta: string) => void
  ): Promise<ChatMessage> {
    const formattedMessages = this.formatMessagesForOllama(messages);
    const isTiny = /0\.5b|1b|1\.5b|mini|small/i.test(model);

    if (onContentDelta && !isTiny) {
      let responseStarted = false;
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: formattedMessages, tools, stream: true }),
          signal
        });
        if (response.ok && response.body) {
          responseStarted = true;
          return await readOllamaToolStream(response, onContentDelta);
        }
      } catch (err) {
        if (signal?.aborted || responseStarted) throw err;
      }
    }

    // Only invoke Ollama native tools parameter on models large enough to reliably parse Ollama's schema template.
    // Compact models (< 7B) experience schema confusion and 4x higher latency when Ollama injects tool prompts.
    // They operate with near-instant speed and high precision using LocalForge's text tool calling protocol.
    if (!isTiny) {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: formattedMessages, tools, stream: false }),
          signal
        });
        if (response.ok) {
          const data = await response.json() as OllamaToolResponse;
          if (data.error) throw new Error(data.error);
          if (data.message && (data.message.tool_calls?.length || typeof data.message.content === 'string')) {
            if (onContentDelta && data.message.content) onContentDelta(data.message.content);
            return data.message;
          }
        }
      } catch (err: any) {
        if (signal?.aborted) throw err;
        // Fallback to standard chat
      }
    }

    // Standard chat without native tools parameter (model will use LocalForge text-tool protocol)
    if (onContentDelta) {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: formattedMessages, stream: true }),
        signal
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Ollama request failed (${response.status}): ${detail || response.statusText}`);
      }
      if (!response.body) throw new Error('Ollama returned an empty response stream.');
      return readOllamaToolStream(response, onContentDelta);
    }

    const fallbackResponse = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: formattedMessages, stream: false }),
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

async function readOllamaToolStream(
  response: Response,
  onContentDelta: (delta: string) => void
): Promise<ChatMessage> {
  if (!response.body) throw new Error('Ollama returned an empty response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let toolCalls: ChatMessage['tool_calls'] = [];

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as OllamaChatChunk;
    if (chunk.error) throw new Error(chunk.error);
    const text = chunk.message?.content;
    if (typeof text === 'string' && text) {
      content += text;
      onContentDelta(text);
    }
    if (chunk.message?.tool_calls?.length) toolCalls = chunk.message.tool_calls;
  };

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (pending.trim()) consumeLine(pending);
  return { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}
