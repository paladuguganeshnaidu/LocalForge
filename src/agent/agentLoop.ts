import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { parseModelTurn } from './toolCallParser';

export type AgentMode = 'ask' | 'plan' | 'agent';

export type AgentStatus = 'planning' | 'executing' | 'waiting_for_approval' | 'completed' | 'failed' | 'cancelled';

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
  timestamps: { startedAt: number; finishedAt?: number };
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

function makeRequestSignal(options: AgentLoopOptions): AbortSignal | undefined {
  const timeoutSignal = options.timeoutMs && options.timeoutMs > 0 ? AbortSignal.timeout(options.timeoutMs) : undefined;
  if (options.signal && timeoutSignal) return AbortSignal.any([options.signal, timeoutSignal]);
  return options.signal ?? timeoutSignal;
}

export class AgentLoop {
  constructor(
    private readonly provider: ModelProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager?: PermissionManager
  ) {}

  public async run(model: string, messages: ChatMessage[], options: AgentLoopOptions = {}): Promise<{ response: string; state: AgentState }> {
    if (!this.provider.chatWithTools) throw new Error('Provider ' + this.provider.id + ' does not support agent tools.');

    const state: AgentState = {
      runId: 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      task: messages.at(-1)?.content ?? '',
      mode: options.mode ?? 'agent',
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

    const tools = this.toolRegistry.getDefinitions(state.mode === 'ask' || state.mode === 'plan' ? 'read' : undefined);
    const allowList = new Set(tools.map((t) => t.function.name));
    const history: ChatMessage[] = [{ role: 'system', content: this.getSystemPrompt(state.mode, tools) }, ...messages];
    const maxRounds = options.maxRounds ?? (state.mode === 'agent' ? 10 : 5);
    const maxCalls = options.maxCallsPerRound ?? 4;
    let finalResponse = '';
    let waitingForApproval = false;

    try {
      updateState('planning');
      for (let round = 0; round < maxRounds; round += 1) {
        if (options.signal?.aborted) {
          state.status = 'cancelled';
          throw new Error('Agent task was cancelled.');
        }

        updateState(round === 0 ? 'planning' : 'executing');
        options.onProgress?.('Generating live agent step ' + (round + 1) + ' of ' + maxRounds);

        const response = await this.provider.chatWithTools(model, history, tools, makeRequestSignal(options));
        const parsed = parseModelTurn(response.content || '', response.tool_calls || []);
        if (parsed.parseWarnings.length) state.errors.push(...parsed.parseWarnings);

        const calls = parsed.toolCalls.filter((call) => allowList.has(call.function?.name || ''));
        for (const blocked of parsed.toolCalls.filter((call) => !allowList.has(call.function?.name || ''))) {
          state.errors.push('Tool ' + (blocked.function?.name || 'unknown') + ' is unavailable in ' + state.mode + ' mode.');
        }

        if (!calls.length) {
          finalResponse = parsed.userVisibleText.slice(0, 30000) || 'Task completed.';
          state.status = 'completed';
          break;
        }

        history.push({ role: 'assistant', content: parsed.userVisibleText, tool_calls: calls });
        const step: AgentStep = { round: round + 1, thought: undefined, toolCalls: [], timestamp: Date.now() };

        for (const [index, call] of calls.entries()) {
          const name = call.function?.name || 'unknown';
          const callId = call.id || 'call-' + round + '-' + index;
          const record: AgentToolCallRecord = { id: callId, name, args: {}, status: 'running', startedAt: Date.now() };
          step.toolCalls.push(record);

          if (index >= maxCalls) {
            record.status = 'blocked';
            record.error = 'Per-round tool-call limit reached.';
            record.completedAt = Date.now();
            this.appendToolResult(history, call, name, { error: record.error });
            continue;
          }

          let args: Record<string, unknown>;
          try {
            args = this.parseArguments(call);
            record.args = args;
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid arguments.';
            record.status = 'error';
            record.error = message;
            record.completedAt = Date.now();
            state.errors.push(name + ': ' + message);
            options.onToolEnd?.(name, undefined, message, callId);
            this.appendToolResult(history, call, name, { error: message });
            continue;
          }

          options.onToolStart?.(name, args, callId);
          options.onProgress?.('Executing ' + name);

          try {
            const result = await this.toolRegistry.executeTool(name, args, this.permissionManager);
            record.status = 'success';
            record.result = result;
            record.completedAt = Date.now();
            options.onToolEnd?.(name, result, undefined, callId);
            this.appendToolResult(history, call, name, result);

            if (result && typeof result === 'object' && (result as Record<string, unknown>).requiresApproval === true) {
              waitingForApproval = true;
              state.status = 'waiting_for_approval';
              finalResponse = typeof (result as Record<string, unknown>).message === 'string'
                ? String((result as Record<string, unknown>).message)
                : 'Changes are ready for review.';
              break;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Workspace tool execution failed.';
            record.status = 'error';
            record.error = message;
            record.completedAt = Date.now();
            state.errors.push(name + ': ' + message);
            options.onToolEnd?.(name, undefined, message, callId);
            this.appendToolResult(history, call, name, { error: message });
          }
        }

        state.steps.push(step);
        updateState(waitingForApproval ? 'waiting_for_approval' : undefined);
        if (waitingForApproval) break;
      }

      if (!waitingForApproval && state.status !== 'completed' && state.status !== 'cancelled') {
        state.status = 'completed';
        if (!finalResponse) finalResponse = 'I reached the agent step limit. Continue the task to proceed.';
      }
    } catch (error: any) {
      if (options.signal?.aborted || error?.name === 'AbortError') {
        state.status = 'cancelled';
      } else {
        state.status = 'failed';
        state.errors.push(error?.message || String(error));
      }
      throw error;
    } finally {
      state.timestamps.finishedAt = Date.now();
      updateState();
    }

    return { response: finalResponse, state };
  }

  private getSystemPrompt(mode: AgentMode, tools: ModelToolDefinition[]): string {
    const toolList = tools.map((t) => '- ' + t.function.name + ': ' + t.function.description).join('\n');
    if (mode === 'ask') {
      return 'You are LocalForge in Ask Mode.\n' +
        'You are strictly read-only. Inspect the workspace with the available read-only tools and answer the user.\n' +
        'Never write, edit, delete, install packages, or execute commands.\n' +
        'Never expose tool-call payloads as visible prose.\n\nAvailable tools:\n' + toolList;
    }
    if (mode === 'plan') {
      return 'You are LocalForge in Plan Mode.\n' +
        'Inspect the workspace with read-only tools and produce a structured implementation plan.\n' +
        'Do not modify files or execute commands.\n' +
        'Never expose tool-call payloads as visible prose.\n\nAvailable tools:\n' + toolList + '\n\n' +
        'Return sections: Objective, Architecture, Files Affected, Implementation Steps, Risks and Edge Cases, Verification.';
    }
    return 'You are LocalForge Copilot Agent.\n' +
      'Inspect the code before changing it. Workspace edit tools create reviewable proposals and do not immediately modify files.\n' +
      'When an edit proposal is returned, stop and wait for the user to review/apply it.\n' +
      'Run commands only when allowed by command policy and permission state.\n' +
      'Never expose hidden reasoning or raw tool-call JSON.\n' +
      'If native tool calling is unavailable, emit exactly LOCALFORGE_TOOL_CALL followed by a JSON object with tool and arguments.\n\nAvailable tools:\n' + toolList;
  }

  private parseArguments(call: ModelToolCall): Record<string, unknown> {
    const parsed = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Tool arguments must be a JSON object.');
    return parsed as Record<string, unknown>;
  }

  private appendToolResult(history: ChatMessage[], call: ModelToolCall, name: string, result: unknown): void {
    let content: string;
    try { content = JSON.stringify(result); } catch { content = JSON.stringify({ error: 'Tool result could not be serialized.' }); }
    history.push({ role: 'tool', tool_call_id: call.id, name, content: content.slice(0, 10000) });
  }
}
