import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';

export type WorkspaceToolExecutor = (name: string, argumentsValue: Record<string, unknown>) => Promise<unknown>;

export interface AgentOptions {
  signal?: AbortSignal;
  onTool?: (message: string) => void;
  maxRounds?: number;
  maxCallsPerRound?: number;
}

export async function runToolAgent(
  provider: ModelProvider,
  model: string,
  messages: ChatMessage[],
  tools: ModelToolDefinition[],
  executeTool: WorkspaceToolExecutor,
  options: AgentOptions = {}
): Promise<string> {
  if (!provider.chatWithTools) throw new Error(`Provider ${provider.id} does not support agent tools.`);
  const allowList = new Set(tools.map((tool) => tool.function.name));
  const history: ChatMessage[] = [
    { role: 'system', content: 'You are LocalForge Agent, a local coding assistant. Use only the provided read-only workspace tools when you need repository facts. Never claim to have changed files or run commands. Explain conclusions and propose edits for the user to review.' },
    ...messages
  ];
  const maxRounds = options.maxRounds ?? 4;
  const maxCalls = options.maxCallsPerRound ?? 2;

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('Agent task was cancelled.');
    const response = await provider.chatWithTools(model, history, tools, options.signal);
    const calls = response.tool_calls ?? [];
    if (!calls.length) return response.content.slice(0, 20000);
    history.push(response);

    for (const [index, call] of calls.entries()) {
      const name = call.function?.name;
      if (index >= maxCalls) {
        appendToolResult(history, call, name || 'unknown', { error: 'Per-round tool-call limit reached.' });
        continue;
      }
      if (!name || !allowList.has(name)) {
        options.onTool?.('Blocked an unrecognized tool request.');
        appendToolResult(history, call, name || 'unknown', { error: 'Tool is not allow-listed.' });
        continue;
      }
      let args: Record<string, unknown>;
      try {
        args = parseArguments(call);
      } catch (error) {
        appendToolResult(history, call, name, { error: error instanceof Error ? error.message : 'Invalid arguments.' });
        continue;
      }
      options.onTool?.(`Using read-only workspace tool: ${name}`);
      try {
        const result = await executeTool(name, args);
        appendToolResult(history, call, name, result);
      } catch (error) {
        appendToolResult(history, call, name, { error: error instanceof Error ? error.message : 'Workspace tool failed.' });
      }
    }
    if (calls.length > maxCalls) options.onTool?.(`Rejected ${calls.length - maxCalls} extra tool request(s) to stay within the per-round limit.`);
  }

  return 'I reached the safe tool-call limit for this request. Ask a follow-up to continue.';
}

function parseArguments(call: ModelToolCall): Record<string, unknown> {
  const value = call.function.arguments;
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be a JSON object.');
  return parsed as Record<string, unknown>;
}

function appendToolResult(history: ChatMessage[], call: ModelToolCall, name: string, result: unknown): void {
  let content: string;
  try {
    content = JSON.stringify(result);
  } catch {
    content = JSON.stringify({ error: 'Tool result could not be serialized.' });
  }
  history.push({ role: 'tool', tool_call_id: call.id, name, content: content.slice(0, 8000) });
}
