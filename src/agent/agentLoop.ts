import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';

export type AgentMode = 'ask' | 'plan' | 'agent';

export type AgentStatus =
  | 'planning'
  | 'executing'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: 'running' | 'success' | 'error' | 'blocked';
  startedAt: number;
  completedAt?: number;
}

export interface AgentStep {
  round: number;
  thought?: string;
  toolCalls: AgentToolCallRecord[];
  timestamp: number;
}

export interface AgentState {
  runId: string;
  task: string;
  mode: AgentMode;
  model: string;
  status: AgentStatus;
  steps: AgentStep[];
  errors: string[];
  timestamps: {
    startedAt: number;
    finishedAt?: number;
  };
}

export interface AgentLoopOptions {
  signal?: AbortSignal;
  mode?: AgentMode;
  maxRounds?: number;
  maxCallsPerRound?: number;
  timeoutMs?: number;
  onStateUpdate?: (state: AgentState) => void;
  onToolStart?: (name: string, args: Record<string, unknown>, id: string) => void;
  onToolEnd?: (name: string, result: unknown, error?: string, id?: string) => void;
  onThought?: (chunk: string) => void;
  onProgress?: (message: string) => void;
}

export class AgentLoop {
  constructor(
    private readonly provider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager?: PermissionManager
  ) {}

  public async run(
    model: string,
    messages: ChatMessage[],
    options: AgentLoopOptions = {}
  ): Promise<{ response: string; state: AgentState }> {
    if (!this.provider.chatWithTools) {
      throw new Error(`Provider ${this.provider.id} does not support agent tools.`);
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const mode = options.mode ?? 'agent';
    const task = messages.at(-1)?.content ?? '';

    const state: AgentState = {
      runId,
      task,
      mode,
      model,
      status: 'planning',
      steps: [],
      errors: [],
      timestamps: { startedAt: Date.now() }
    };

    const updateState = (status?: AgentStatus) => {
      if (status) state.status = status;
      options.onStateUpdate?.(state);
    };

    const tools = this.toolRegistry.getDefinitions(mode === 'ask' || mode === 'plan' ? 'read' : undefined);
    const allowList = new Set(tools.map((t) => t.function.name));
    const systemPrompt = this.getSystemPrompt(mode, tools);

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const maxRounds = options.maxRounds ?? (mode === 'agent' ? 8 : 4);
    const maxCalls = options.maxCallsPerRound ?? 3;

    let finalResponse = '';

    try {
      updateState('executing');

      for (let round = 0; round < maxRounds; round += 1) {
        if (options.signal?.aborted) {
          state.status = 'cancelled';
          throw new Error('Agent task was cancelled.');
        }

        options.onProgress?.(`Round ${round + 1} / ${maxRounds}`);

        const response = await this.provider.chatWithTools(model, history, tools, options.signal);

        let calls = response.tool_calls ?? [];
        if (!calls.length && response.content) {
          calls = this.extractTextToolCalls(response.content, allowList);
        }

        if (response.content?.trim()) {
          options.onThought?.(response.content);
        }

        if (!calls.length) {
          finalResponse = response.content?.slice(0, 30000) || 'Task completed.';
          state.status = 'completed';
          break;
        }

        history.push(response);

        const currentStep: AgentStep = {
          round: round + 1,
          thought: response.content,
          toolCalls: [],
          timestamp: Date.now()
        };

        for (const [index, call] of calls.entries()) {
          const name = call.function?.name || 'unknown';
          const callId = call.id || `call-${round}-${index}`;

          const callRecord: AgentToolCallRecord = {
            id: callId,
            name,
            args: {},
            status: 'running',
            startedAt: Date.now()
          };
          currentStep.toolCalls.push(callRecord);

          if (index >= maxCalls) {
            callRecord.status = 'blocked';
            callRecord.error = 'Per-round tool-call limit reached.';
            callRecord.completedAt = Date.now();
            this.appendToolResult(history, call, name, { error: callRecord.error });
            continue;
          }

          if (!allowList.has(name)) {
            callRecord.status = 'blocked';
            callRecord.error = 'Tool is not allow-listed.';
            callRecord.completedAt = Date.now();
            options.onToolEnd?.(name, undefined, callRecord.error, callId);
            this.appendToolResult(history, call, name, { error: callRecord.error });
            continue;
          }

          let args: Record<string, unknown>;
          try {
            args = this.parseArguments(call);
            callRecord.args = args;
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Invalid arguments.';
            callRecord.status = 'error';
            callRecord.error = errMsg;
            callRecord.completedAt = Date.now();
            options.onToolEnd?.(name, undefined, errMsg, callId);
            this.appendToolResult(history, call, name, { error: errMsg });
            continue;
          }

          options.onToolStart?.(name, args, callId);

          try {
            const result = await this.toolRegistry.executeTool(name, args, this.permissionManager);
            callRecord.status = 'success';
            callRecord.result = result;
            callRecord.completedAt = Date.now();
            options.onToolEnd?.(name, result, undefined, callId);
            this.appendToolResult(history, call, name, result);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Workspace tool execution failed.';
            callRecord.status = 'error';
            callRecord.error = errMsg;
            callRecord.completedAt = Date.now();
            state.errors.push(`${name}: ${errMsg}`);
            options.onToolEnd?.(name, undefined, errMsg, callId);
            this.appendToolResult(history, call, name, { error: errMsg });
          }
        }

        state.steps.push(currentStep);
        updateState();
      }

      if (state.status !== 'completed' && state.status !== 'cancelled') {
        state.status = 'completed';
        if (!finalResponse) {
          finalResponse = 'I reached the step limit for this interaction. Ask a follow-up to continue.';
        }
      }
    } catch (error: any) {
      if (options.signal?.aborted) {
        state.status = 'cancelled';
      } else {
        state.status = 'failed';
        state.errors.push(error.message || String(error));
      }
      throw error;
    } finally {
      state.timestamps.finishedAt = Date.now();
      updateState();
    }

    return { response: finalResponse, state };
  }

  private getSystemPrompt(mode: AgentMode, tools: ModelToolDefinition[]): string {
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
## Objective & Architecture
## Files Affected (existing files to edit or new files to create)
## Implementation Checklist (use markdown checkboxes: "- [ ] Step 1...")
## Edge Cases & Verification

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

  private extractTextToolCalls(content: string, allowList: Set<string>): ModelToolCall[] {
    const calls: ModelToolCall[] = [];
    const tagPattern = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim()) as {
          name?: string;
          tool?: string;
          arguments?: Record<string, unknown>;
          args?: Record<string, unknown>;
        };
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

  private parseArguments(call: ModelToolCall): Record<string, unknown> {
    const value = call.function.arguments;
    const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Tool arguments must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }

  private appendToolResult(
    history: ChatMessage[],
    call: ModelToolCall,
    name: string,
    result: unknown
  ): void {
    let content: string;
    try {
      content = JSON.stringify(result);
    } catch {
      content = JSON.stringify({ error: 'Tool result could not be serialized.' });
    }
    history.push({ role: 'tool', tool_call_id: call.id, name, content: content.slice(0, 8000) });
  }
}
