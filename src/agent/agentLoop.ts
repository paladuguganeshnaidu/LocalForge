import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { ToolCallParser } from './toolCallParser';
import { VisibleTextStream } from './visibleTextStream';
import { withCancellation } from '../core/cancellation';

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
  status: 'running' | 'success' | 'error' | 'blocked' | 'cancelled';
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
  unresolvedErrors: string[];
  timestamps: {
    startedAt: number;
    finishedAt?: number;
  };
}

export type ExecutionStrategy = 'fast' | 'planning';

export interface AgentLoopOptions {
  signal?: AbortSignal;
  mode?: AgentMode;
  strategy?: ExecutionStrategy;
  maxRounds?: number;
  maxCallsPerRound?: number;
  timeoutMs?: number;
  toolTimeoutMs?: number;
  onStateUpdate?: (state: AgentState) => void;
  onToolStart?: (name: string, args: Record<string, unknown>, id: string) => void;
  onToolEnd?: (name: string, result: unknown, error?: string, id?: string) => void;
  onThought?: (chunk: string) => void;
  onProgress?: (message: string) => void;
  onModelOutput?: (text: string, round: number, toolNames: string[]) => void;
  onModelText?: (text: string, round: number) => void;
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
    const strategy = options.strategy ?? (mode === 'plan' ? 'planning' : 'fast');
    const task = messages.at(-1)?.content ?? '';

    const state: AgentState = {
      runId,
      task,
      mode,
      model,
      status: 'planning',
      steps: [],
      errors: [],
      unresolvedErrors: [],
      timestamps: { startedAt: Date.now() }
    };

    const updateState = (status?: AgentStatus) => {
      if (status) state.status = status;
      options.onStateUpdate?.(state);
    };

    const tools = this.toolRegistry.getDefinitions(mode === 'ask' || mode === 'plan' ? 'read' : undefined);
    const allowList = new Set(tools.map((t) => t.function.name));
    const systemPrompt = this.getSystemPrompt(mode, tools, strategy);

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const maxRounds = options.maxRounds ?? (mode === 'agent' ? (strategy === 'planning' ? 10 : 6) : 4);
    const maxCalls = options.maxCallsPerRound ?? 4;

    let finalResponse = '';
    const unresolvedToolErrors = new Map<string, string>();
    let recoveryAttempts = 0;
    let lastSuccessfulToolCall: { fingerprint: string; result: unknown } | undefined;
    const toolFailureKey = (name: string, args: Record<string, unknown>, callId: string): string => {
      const target = typeof args.path === 'string' ? args.path : typeof args.command === 'string' ? args.command : '*';
      return `${name}:${target}`;
    };
    const recordToolFailure = (key: string, message: string): void => {
      state.errors.push(message);
      unresolvedToolErrors.set(key, message);
    };

    // Overall task timeout controller
    const loopController = new AbortController();
    const abortFromParent = () => loopController.abort(options.signal?.reason);
    let timeoutTimer: NodeJS.Timeout | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => loopController.abort(), options.timeoutMs);
    }
    if (options.signal) {
      if (options.signal.aborted) {
        abortFromParent();
      } else {
        options.signal.addEventListener('abort', abortFromParent, { once: true });
      }
    }
    const signal = loopController.signal;

    try {
      updateState('executing');

      for (let round = 0; round < maxRounds; round += 1) {
        if (signal.aborted) {
          state.status = 'cancelled';
          throw new Error('Agent task was cancelled.');
        }

        options.onProgress?.(`Model working · step ${round + 1} / ${maxRounds}`);

        const visibleStream = new VisibleTextStream((text) => {
          if (!signal.aborted) options.onModelText?.(text, round + 1);
        });
        const response = await withCancellation(this.provider.chatWithTools(
          model,
          history,
          tools,
          signal,
          (chunk) => visibleStream.push(chunk)
        ), signal);
        signal.throwIfAborted();
        const parsed = ToolCallParser.parse(response.content, response.tool_calls, allowList);
        visibleStream.finish(parsed.userVisibleText);
        const calls = parsed.toolCalls;
        options.onModelOutput?.(parsed.userVisibleText, round + 1, calls.map((call) => call.function.name));

        if (!calls.length) {
          if (unresolvedToolErrors.size > 0 && mode === 'agent' && recoveryAttempts < 2 && round + 1 < maxRounds) {
            const currentStep: AgentStep = {
              round: round + 1,
              thought: undefined,
              toolCalls: [],
              timestamp: Date.now()
            };
            state.steps.push(currentStep);
            history.push({ role: 'assistant', content: parsed.userVisibleText });
            history.push({
              role: 'user',
              content: `A previous tool action failed and its result has not been recovered yet:\n${Array.from(unresolvedToolErrors.values()).join('\n').slice(0, 1200)}\n\nDo not claim completion. Inspect the relevant workspace file or command result, correct the tool arguments, and retry the requested work. If recovery is impossible, explain the blocker instead of claiming success.`
            });
            recoveryAttempts += 1;
            options.onProgress?.(`Recovering from tool failure (${recoveryAttempts} / 2)...`);
            state.unresolvedErrors = Array.from(unresolvedToolErrors.values());
            updateState('executing');
            continue;
          }
          finalResponse = parsed.userVisibleText || this.emptyResponseFor(state);
          state.unresolvedErrors = Array.from(unresolvedToolErrors.values());
          state.status = state.unresolvedErrors.length ? 'failed' : 'completed';
          break;
        }

        history.push({
          role: 'assistant',
          content: parsed.userVisibleText,
          tool_calls: calls
        });

        const currentStep: AgentStep = {
          round: round + 1,
          thought: undefined,
          toolCalls: [],
          timestamp: Date.now()
        };

        for (const [index, call] of calls.entries()) {
          const previousSuccessfulToolCall = lastSuccessfulToolCall;
          lastSuccessfulToolCall = undefined;
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
            recordToolFailure(`${name}:${callId}`, `${name}: ${callRecord.error}`);
            options.onToolEnd?.(name, undefined, callRecord.error, callId);
            this.appendToolResult(history, call, name, { error: callRecord.error });
            continue;
          }

          if (!allowList.has(name)) {
            callRecord.status = 'blocked';
            callRecord.error = 'Tool is not allow-listed.';
            callRecord.completedAt = Date.now();
            recordToolFailure(`${name}:${callId}`, `${name}: ${callRecord.error}`);
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
            recordToolFailure(`${name}:*`, `${name}: ${errMsg}`);
            options.onToolEnd?.(name, undefined, errMsg, callId);
            this.appendToolResult(history, call, name, { error: errMsg });
            continue;
          }

          const fingerprint = `${name}:${stableSerialize(args)}`;
          options.onToolStart?.(name, args, callId);

          if (previousSuccessfulToolCall?.fingerprint === fingerprint) {
            const cached = previousSuccessfulToolCall.result;
            const reusedResult = cached && typeof cached === 'object' && !Array.isArray(cached)
              ? {
                  ...(cached as Record<string, unknown>),
                  duplicateSuppressed: true,
                  message: 'This identical tool request already succeeded in this turn; its result is reused without running it again.'
                }
              : {
                  success: true,
                  duplicateSuppressed: true,
                  previousResult: cached,
                  message: 'This identical tool request already succeeded in this turn; its result is reused without running it again.'
                };
            callRecord.status = 'success';
            callRecord.result = reusedResult;
            callRecord.completedAt = Date.now();
            lastSuccessfulToolCall = previousSuccessfulToolCall;
            options.onToolEnd?.(name, reusedResult, undefined, callId);
            this.appendToolResult(history, call, name, reusedResult);
            continue;
          }

          try {
            const result = await this.toolRegistry.executeTool(name, args, this.permissionManager, {
              signal,
              timeoutMs: options.toolTimeoutMs ?? 60000
            });

            const resultError = this.describeToolResultError(result);
            callRecord.status = resultError ? 'error' : 'success';
            callRecord.result = result;
            callRecord.error = resultError;
            callRecord.completedAt = Date.now();
            const failureKey = toolFailureKey(name, args, callId);
            if (resultError) recordToolFailure(failureKey, `${name}: ${resultError}`);
            else {
              lastSuccessfulToolCall = { fingerprint, result };
              unresolvedToolErrors.delete(failureKey);
              unresolvedToolErrors.delete(`${name}:*`);
            }
            options.onToolEnd?.(name, result, resultError, callId);
            this.appendToolResult(history, call, name, result);
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : 'Workspace tool execution failed.';
            if (signal.aborted) {
              callRecord.status = 'cancelled';
              callRecord.error = errMsg;
              callRecord.completedAt = Date.now();
              options.onToolEnd?.(name, undefined, errMsg, callId);
              state.steps.push(currentStep);
              throw error;
            }
            callRecord.status = 'error';
            callRecord.error = errMsg;
            callRecord.completedAt = Date.now();
            recordToolFailure(toolFailureKey(name, args, callId), `${name}: ${errMsg}`);
            options.onToolEnd?.(name, undefined, errMsg, callId);
            this.appendToolResult(history, call, name, { error: errMsg });
          }
        }

        state.steps.push(currentStep);
        state.unresolvedErrors = Array.from(unresolvedToolErrors.values());
        updateState();
      }

      if (state.status !== 'completed' && state.status !== 'cancelled') {
        state.unresolvedErrors = Array.from(unresolvedToolErrors.values());
        state.status = state.unresolvedErrors.length ? 'failed' : 'completed';
        if (!finalResponse) {
          const completedToolCall = state.steps.some((step) => step.toolCalls.some((call) => call.status === 'success'));
          finalResponse = state.unresolvedErrors.length || completedToolCall
            ? this.emptyResponseFor(state)
            : 'I reached the step limit for this interaction. Ask a follow-up to continue.';
        }
      }
    } catch (error: any) {
      if (signal.aborted) {
        state.status = 'cancelled';
      } else {
        state.status = 'failed';
        state.errors.push(error.message || String(error));
      }
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener('abort', abortFromParent);
      state.timestamps.finishedAt = Date.now();
      updateState();
    }

    return { response: this.addToolFailureNotice(finalResponse, state), state };
  }

  private getSystemPrompt(mode: AgentMode, tools: ModelToolDefinition[], strategy: ExecutionStrategy = 'planning'): string {
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
## Files to Change (existing files to edit or new files to create)
## Implementation Steps (use markdown checkboxes: "- [ ] Step 1...")
## Dependencies & Risks
## Verification

Do NOT execute write tools or edit files in Plan Mode. Only output the plan for review.
When a read tool is required, output exactly one LOCALFORGE_TOOL_CALL object:
{ "tool": "tool_name", "arguments": {...} }
Do not surround it with markdown. Do not explain the tool call.`;
    }

    const strategyInstructions = strategy === 'fast'
      ? 'Execute the task directly and surgically with minimal overhead.'
      : 'First inspect the architecture and affected files, understand dependencies, and verify changes.';

    return `You are LocalForge Copilot Agent, an autonomous software engineering assistant.
You can inspect code, write/edit files, and run commands to complete coding tasks end-to-end.
Strategy: ${strategy} (${strategyInstructions})
Available workspace tools:
${toolList}

Workflow:
1. Inspect relevant files and search workspace context before making changes.
2. Apply clean, surgical file edits using edit_workspace_file or write_workspace_file.
   Use create_file for creation-only, replace_range for line replacements, delete_file for deletion, and move_file for renames/moves. These file tools prepare reviewable proposals unless explicitly configured to apply approved actions.
3. Run tests or check status with run_command if needed.
4. Conclude with a clear explanation of all changes made.

Safety and accuracy:
- File paths must be relative to the currently open workspace. Never target files under a user home directory or outside the workspace.
- For edit_workspace_file, provide the exact, non-empty target_content copied from the file and a replacement_content. If you cannot identify the exact text, read the file first; do not guess.
- If an action fails, do not claim that it succeeded. Retry only after correcting the cause; otherwise stop and explain what failed.
- Never show raw tool JSON or raw tool error payloads to the user.
- Report completion only when tool results confirm the requested changes.
- A proposed edit is not an applied edit. If results say proposed or pending, tell the user the changes await review; do not claim that files were changed or tests validated the proposal.

When a tool is required, output exactly one LOCALFORGE_TOOL_CALL object:
{ "tool": "tool_name", "arguments": {...} }
Do not surround it with markdown. Do not explain the tool call.
You may also invoke tools using native provider function calls or <tool_call>{"name": "...", "arguments": {...}}</tool_call>.`;
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

  private describeToolResultError(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const value = result as Record<string, unknown>;
    if (value.success === false) {
      return typeof value.error === 'string' ? value.error : 'The tool reported that it did not complete successfully.';
    }
    if (typeof value.exitCode === 'number' && value.exitCode !== 0) {
      const stderr = typeof value.stderr === 'string' ? value.stderr.trim() : '';
      return stderr ? `Command exited with code ${value.exitCode}: ${stderr.slice(0, 500)}` : `Command exited with code ${value.exitCode}.`;
    }
    if (value.status === 'failed' || value.status === 'timed_out' || value.status === 'stopped' || value.status === 'stopping') {
      const stderr = typeof value.stderr === 'string' ? value.stderr.trim() : '';
      const state = value.status === 'timed_out' ? 'timed out' : value.status === 'stopped' ? 'was stopped' : value.status === 'stopping' ? 'is stopping' : 'failed';
      return stderr ? `Command ${state}: ${stderr.slice(0, 500)}` : `Command ${state}.`;
    }
    return undefined;
  }

  private emptyResponseFor(state: AgentState): string {
    if (state.unresolvedErrors.length > 0) {
      return 'The model did not provide a final summary, and one or more tool actions reported errors. Review the failed steps above before treating this task as complete.';
    }
    const successfulCalls = state.steps.flatMap((step) => step.toolCalls)
      .filter((call) => call.status === 'success');
    if (successfulCalls.length > 0) {
      const outcomes = new Set(successfulCalls.map((call) => {
        const result = call.result && typeof call.result === 'object'
          ? call.result as Record<string, unknown>
          : {};
        const path = typeof result.path === 'string' ? result.path : typeof result.from === 'string' && typeof result.to === 'string'
          ? `${result.from} → ${result.to}` : '';

        if (result.proposed === true || result.status === 'pending') {
          return path
            ? `Prepared a change for review: ${path} (not applied).`
            : 'Prepared a change for review (not applied).';
        }
        if (result.applied === true && path) return `Applied the approved change to ${path}.`;
        if (typeof result.exitCode === 'number') return `Command finished with exit code ${result.exitCode}.`;
        return `Completed ${call.name}.`;
      }));
      return `The model did not provide a written summary. Verified tool results:\n${Array.from(outcomes).map((outcome) => `- ${outcome}`).join('\n')}`;
    }
    if (state.steps.some((step) => step.toolCalls.length > 0)) {
      return 'The model did not provide a final summary. Review the activity above for tool outcomes.';
    }
    return 'The model returned an empty response. Try rephrasing your request or selecting another model.';
  }

  private addToolFailureNotice(response: string, state: AgentState): string {
    const cleaned = response.trim();
    if (!state.unresolvedErrors.length) return cleaned;

    const notice = 'Some tool actions failed during this turn, so I cannot confirm that all requested work completed. Review the failed activity steps above before accepting any changes.';
    if (/^(?:the )?task (?:is )?completed[.!]?$/i.test(cleaned)) {
      return `I could not verify successful completion. ${notice}`;
    }
    if (!cleaned) return notice;
    return `${cleaned}\n\n> ${notice}`;
  }
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}
