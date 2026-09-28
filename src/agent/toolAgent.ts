import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';

export type WorkspaceToolExecutor = (name: string, argumentsValue: Record<string, unknown>) => Promise<unknown>;

export type AgentMode = 'ask' | 'plan' | 'agent';

export interface AgentToolEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'success' | 'error';
  result?: unknown;
  error?: string;
}

export interface AgentOptions {
  signal?: AbortSignal;
  mode?: AgentMode;
  onTool?: (message: string) => void;
  onToolStart?: (name: string, args: Record<string, unknown>, id: string) => void;
  onToolEnd?: (name: string, result: unknown, error?: string, id?: string) => void;
  onThought?: (chunk: string) => void;
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
  const mode = options.mode ?? 'agent';
  const systemPrompt = getSystemPromptForMode(mode, tools);

  const history: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages
  ];

  const maxRounds = options.maxRounds ?? (mode === 'agent' ? 8 : 4);
  const maxCalls = options.maxCallsPerRound ?? 3;

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) throw new Error('Agent task was cancelled.');
    const response = await provider.chatWithTools(model, history, tools, options.signal);
    
    // Check for native tool calls or fallback text-embedded tool calls
    let calls = response.tool_calls ?? [];
    if (!calls.length && response.content) {
      calls = extractTextToolCalls(response.content, allowList);
    }

    if (!calls.length) {
      return response.content.slice(0, 30000);
    }

    if (response.content.trim()) {
      options.onThought?.(response.content);
    }

    history.push(response);

    for (const [index, call] of calls.entries()) {
      const name = call.function?.name;
      const callId = call.id || `call-${round}-${index}`;
      if (index >= maxCalls) {
        appendToolResult(history, call, name || 'unknown', { error: 'Per-round tool-call limit reached.' });
        continue;
      }
      if (!name || !allowList.has(name)) {
        options.onTool?.(`Blocked tool request: ${name || 'unknown'}`);
        options.onToolEnd?.(name || 'unknown', undefined, 'Tool is not allow-listed.', callId);
        appendToolResult(history, call, name || 'unknown', { error: 'Tool is not allow-listed.' });
        continue;
      }
      let args: Record<string, unknown>;
      try {
        args = parseArguments(call);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Invalid arguments.';
        options.onToolEnd?.(name, undefined, errMsg, callId);
        appendToolResult(history, call, name, { error: errMsg });
        continue;
      }

      options.onTool?.(`Executing ${name}`);
      options.onToolStart?.(name, args, callId);

      try {
        const result = await executeTool(name, args);
        options.onToolEnd?.(name, result, undefined, callId);
        appendToolResult(history, call, name, result);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Workspace tool failed.';
        options.onToolEnd?.(name, undefined, errMsg, callId);
        appendToolResult(history, call, name, { error: errMsg });
      }
    }

    if (calls.length > maxCalls) {
      options.onTool?.(`Deferred ${calls.length - maxCalls} extra tool call(s) to next step.`);
    }
  }

  return 'I reached the step limit for this interaction. Ask a follow-up to continue.';
}

function getSystemPromptForMode(mode: AgentMode, tools: ModelToolDefinition[]): string {
  const toolList = tools.map((t) => `- ${t.function.name}: ${t.function.description}`).join('\n');
  if (mode === 'ask') {
    return `You are LocalForge in Ask Mode. Answer questions clearly, accurately, and thoroughly about the workspace and code.
You have access to read-only tools to inspect the workspace before answering:
${toolList}

Inspect files when necessary to give accurate answers. Do NOT write or edit files. Always reference file names and line numbers.`;
  }

  if (mode === 'plan') {
    return `You are LocalForge in Plan Mode, acting as an expert software architect.
Your goal is to inspect the workspace and produce a comprehensive, structured implementation plan.
Available read-only inspection tools:
${toolList}

Format your plan with the following clear markdown structure:
## 🎯 Objective & Architecture
## 📁 Files Affected (existing files to edit or new files to create)
## 📋 Step-by-Step Implementation Checklist (use markdown checkboxes: "- [ ] Step 1...")
## ⚠️ Edge Cases & Validation

Do NOT execute write tools or edit files in Plan Mode. Only output the plan for review.`;
  }

  return `You are LocalForge Copilot Agent, an autonomous software engineering assistant.
You can inspect code, write/edit files, and run commands to complete coding tasks end-to-end.
Available workspace tools:
${toolList}

Workflow:
1. Inspect relevant files and search workspace context before making changes.
2. Apply clean, surgical file edits using edit_workspace_file or write_workspace_file.
3. Run tests or check status with run_command if needed.
4. Conclude with a clear explanation of all changes made.

You can invoke tools using native function calls, or by including:
<tool_call>
{"name": "tool_name", "arguments": {"arg1": "value"}}
</tool_call>`;
}

function extractTextToolCalls(content: string, allowList: Set<string>): ModelToolCall[] {
  const calls: ModelToolCall[] = [];
  const tagPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as { name?: string; tool?: string; arguments?: Record<string, unknown>; args?: Record<string, unknown> };
      const toolName = parsed.name || parsed.tool;
      const toolArgs = parsed.arguments || parsed.args || {};
      if (toolName && allowList.has(toolName)) {
        calls.push({
          id: `text-call-${calls.length + 1}`,
          type: 'function',
          function: { name: toolName, arguments: JSON.stringify(toolArgs) }
        });
      }
    } catch {}
  }
  return calls;
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
