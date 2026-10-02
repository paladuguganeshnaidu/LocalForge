import { ChatMessage, LocalModel, ModelProvider, ModelToolDefinition } from './modelProvider';

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

interface CompletionChunk {
  choices?: Array<{ delta?: {
    content?: string | Array<{ text?: string }>;
    tool_calls?: Array<{ index?: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }>;
  } }>;
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
  readonly source: 'local' | 'remote';
  private readonly baseUrl: string;

  constructor(id: string, baseUrl: string) {
    this.id = id;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    let loopback = false;
    try {
      const url = new URL(this.baseUrl);
      loopback = ['http:', 'https:'].includes(url.protocol) && (['localhost', '[::1]'].includes(url.hostname) || /^127\./.test(url.hostname));
    } catch {}
    this.source = loopback ? 'local' : 'remote';
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
    return (data.data ?? []).flatMap((model) => model.id ? [{ name: model.id, source: this.source }] : []);
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

  async chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
    onContentDelta?: (delta: string) => void
  ): Promise<ChatMessage> {
    if (onContentDelta) {
      let responseStarted = false;
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, tools, stream: true }),
          signal
        });
        if (response.ok && response.body) {
          responseStarted = true;
          if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream')) {
            const data = await response.json() as ToolResponse;
            if (data.error) throw new Error(data.error.message || `${this.id} returned an agent error.`);
            const message = data.choices?.[0]?.message;
            if (message) {
              if (message.content) onContentDelta(message.content);
              const toolCalls = (message.tool_calls ?? []).flatMap((call) => call.function?.name ? [{
                id: call.id,
                type: 'function' as const,
                function: { name: call.function.name, arguments: call.function.arguments ?? '{}' }
              }] : []);
              return { role: 'assistant', content: message.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
            }
            throw new Error(`${this.id} returned an invalid agent response.`);
          }
          return await readOpenAiToolStream(response, onContentDelta, this.id);
        }
      } catch (err) {
        if (signal?.aborted || responseStarted) throw err;
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, stream: false }),
        signal
      });
      if (response.ok) {
        const data = await response.json() as ToolResponse;
        if (data.error) throw new Error(data.error.message || `${this.id} returned an agent error.`);
        const message = data.choices?.[0]?.message;
        if (message) {
          if (onContentDelta && message.content) onContentDelta(message.content);
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
    } catch (err: any) {
      if (signal?.aborted) throw err;
      // Fallback if tools are unsupported
    }

    // Fallback: standard chat without native tools parameter
    const fallbackResponse = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal
    });
    if (!fallbackResponse.ok) {
      const detail = await fallbackResponse.text();
      throw new Error(`${this.id} agent request failed (${fallbackResponse.status}): ${detail || fallbackResponse.statusText}`);
    }
    const fallbackData = await fallbackResponse.json() as ToolResponse;
    if (fallbackData.error) throw new Error(fallbackData.error.message || `${this.id} returned an agent error.`);
    const fallbackMessage = fallbackData.choices?.[0]?.message;
    if (!fallbackMessage) throw new Error(`${this.id} returned an invalid response.`);
    if (onContentDelta && fallbackMessage.content) onContentDelta(fallbackMessage.content);
    return { role: 'assistant', content: fallbackMessage.content ?? '' };
  }
}

async function readOpenAiToolStream(
  response: Response,
  onContentDelta: (delta: string) => void,
  providerId: string
): Promise<ChatMessage> {
  if (!response.body) throw new Error(`${providerId} returned an empty agent stream.`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCalls: Array<{ id?: string; type: 'function'; function: { name: string; arguments: string } }> = [];
  let content = '';
  let pending = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let chunk: CompletionChunk;
    try {
      chunk = JSON.parse(data) as CompletionChunk;
    } catch {
      return;
    }
    if (chunk.error) throw new Error(chunk.error.message || `${providerId} returned an agent error.`);
    const delta = chunk.choices?.[0]?.delta;
    if (typeof delta?.content === 'string') {
      content += delta.content;
      onContentDelta(delta.content);
    } else if (Array.isArray(delta?.content)) {
      for (const item of delta.content) {
        if (item.text) {
          content += item.text;
          onContentDelta(item.text);
        }
      }
    }
    for (const incoming of delta?.tool_calls ?? []) {
      const index = incoming.index ?? toolCalls.length;
      const existing = toolCalls[index] ?? { type: 'function' as const, function: { name: '', arguments: '' } };
      if (incoming.id) existing.id = incoming.id;
      if (incoming.function?.name) existing.function.name += incoming.function.name;
      if (incoming.function?.arguments) existing.function.arguments += incoming.function.arguments;
      toolCalls[index] = existing;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (pending.trim()) consumeLine(pending);
  return {
    role: 'assistant',
    content,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {})
  };
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
    // Malformed SSE data recovery
    return;
  }
  if (chunk.error) throw new Error(chunk.error.message || 'The OpenAI-compatible server returned an error.');
  const content = chunk.choices?.[0]?.delta?.content;
  if (typeof content === 'string') onToken(content);
  else if (Array.isArray(content)) for (const item of content) if (item.text) onToken(item.text);
}
