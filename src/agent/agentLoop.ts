import { ChatMessage, ModelProvider, ModelToolCall, ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { ToolCallParser } from './toolCallParser';
import { VisibleTextStream } from './visibleTextStream';
import { withCancellation } from '../core/cancellation';
import { normalizeAssistantMarkdown } from '../core/responseFormatting';

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
  maxHistoryCharacters?: number;
  requireToolUse?: boolean;
  readOnlyInspection?: boolean;
  validateFinalResponse?: (response: string, state: AgentState) => string | undefined;
  formatFinalResponse?: (response: string, state: AgentState) => string;
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

    const tools = this.toolRegistry.getDefinitions(mode === 'ask' || mode === 'plan' || options.readOnlyInspection ? 'read' : undefined);
    const allowList = new Set(tools.map((t) => t.function.name));
    const systemPrompt = this.getSystemPrompt(options.readOnlyInspection ? 'ask' : mode, tools, strategy) + (options.requireToolUse ? '\n\nThis task requires actual inspection or execution. Your FIRST response must contain only an offered tool call, not a summary, sample application, or explanation. Use the schema above and the relevant path from the request. After the tool result arrives, finish the requested answer using only that evidence.' : '');

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];

    const configuredRounds = options.maxRounds ?? (mode === 'agent' ? 80 : 24);
    const maxRounds = configuredRounds === 0 ? Infinity : Math.max(1, configuredRounds);
    const maxCalls = options.maxCallsPerRound ?? 4;
    const maxHistoryCharacters = Math.max(16000, options.maxHistoryCharacters ?? 48000);
    let repeatedCalls = 0;

    let finalResponse = '';
    const unresolvedToolErrors = new Map<string, string>();
    let recoveryAttempts = 0;
    let inspectionRetries = 0;
    let answerRetries = 0;
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

      agentRounds: for (let round = 0; round < maxRounds; round += 1) {
        if (signal.aborted) {
          state.status = 'cancelled';
          throw new Error('Agent task was cancelled.');
        }

        options.onProgress?.('Thinking');
        compactHistory(history, maxHistoryCharacters, messages.at(-1));

        const visibleStream = new VisibleTextStream((text) => {
          const hasEvidence = state.steps.some((step) => step.toolCalls.some((call) => call.status === 'success'));
          if (!signal.aborted && (!options.requireToolUse || hasEvidence)) options.onModelText?.(text, round + 1);
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
          if (options.requireToolUse && !state.steps.some((step) => step.toolCalls.some((call) => call.status === 'success'))) {
            if (inspectionRetries < 2 && round + 1 < maxRounds) {
              inspectionRetries += 1;
              history.push({ role: 'user', content: 'You have not successfully inspected or executed the requested work yet. Do not answer from guesses or claim completion. Call the relevant offered tool now, using the exact argument names in its schema. For a file inspection, use LOCALFORGE_TOOL_CALL {"tool":"read_file","arguments":{"path":"package.json"}} with the actual path requested by the user; use list_directory with a directory path for directory inspection. Wait for a successful tool result before concluding.' });
              options.onProgress?.('Checking the request before answering');
              continue;
            }
            recordToolFailure('inspection', 'The model did not successfully inspect or execute the requested work. Its answer is unverified; try a more capable model or a more specific file/task request.');
          }
          const candidateAnswer = normalizeAssistantMarkdown(parsed.userVisibleText);
          const groundedAnswer = options.formatFinalResponse?.(candidateAnswer, state) ?? candidateAnswer;
          const answerIssue = options.validateFinalResponse?.(groundedAnswer, state);
          if (answerIssue) {
            if (answerRetries < 2 && round + 1 < maxRounds) {
              answerRetries += 1;
              history.push({ role: 'assistant', content: parsed.userVisibleText });
              history.push({ role: 'user', content: `The final answer needs a correction based on the successfully inspected files: ${answerIssue}` });
              options.onProgress?.('Checking the summary against inspected files');
              continue;
            }
            recordToolFailure('answer', answerIssue);
          }
          if (unresolvedToolErrors.size > 0 && !answerIssue && recoveryAttempts < 2 && round + 1 < maxRounds) {
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
            options.onProgress?.('Checking the failed action and correcting its arguments');
            state.unresolvedErrors = Array.from(unresolvedToolErrors.values());
            updateState('executing');
            continue;
          }
          const missingInspection = options.requireToolUse && !state.steps.some((step) => step.toolCalls.some((call) => call.status === 'success'));
          finalResponse = missingInspection ? '## Inspection needed\nI could not ground a project answer in a successful inspection. I have not verified the requested work.' : groundedAnswer || this.emptyResponseFor(state);
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
            repeatedCalls += 1;
            if (repeatedCalls >= 4) {
              callRecord.status = 'blocked';
              callRecord.error = 'The model repeated the same successful action without making progress. Choose a different path or tool, or explain what is blocking the task.';
              callRecord.completedAt = Date.now();
              recordToolFailure(`${name}:*`, `${name}: ${callRecord.error}`);
              options.onToolEnd?.(name, undefined, callRecord.error, callId);
              this.appendToolResult(history, call, name, { error: callRecord.error });
              state.steps.push(currentStep);
              state.status = 'failed';
              break agentRounds;
            }
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
            repeatedCalls = 0;
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
              if (name === 'read_file' || name === 'read_workspace_file') unresolvedToolErrors.delete(`list_directory:${String(args.path ?? '*')}`);
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
        const pendingReview = state.steps.some((step) => step.toolCalls.some((call) => {
          const result = call.result as Record<string, unknown> | undefined;
          return call.status === 'success' && (result?.proposed === true || result?.status === 'pending');
        }));
        if (!state.unresolvedErrors.length && !pendingReview) {
          const message = 'The configured task-round budget was reached before the model supplied a final answer. Continue the task or increase Task rounds in Settings; 0 removes that cap.';
          state.errors.push(message);
          state.unresolvedErrors.push(message);
        }
        state.status = state.unresolvedErrors.length ? 'failed' : 'waiting_for_approval';
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

    return { response: normalizeAssistantMarkdown(this.addToolFailureNotice(finalResponse, state)), state };
  }

  private getSystemPrompt(mode: AgentMode, tools: ModelToolDefinition[], strategy: ExecutionStrategy = 'planning'): string {
    const toolList = tools.map((tool) => {
      const properties = tool.function.parameters.properties as Record<string, { type?: string }> | undefined;
      const fields = Object.fromEntries(Object.entries(properties ?? {}).map(([name, schema]) => [name, schema.type ?? 'value']));
      return `- ${tool.function.name}: ${tool.function.description}\n  Arguments: ${JSON.stringify(fields)}; required: ${JSON.stringify(tool.function.parameters.required ?? [])}`;
    }).join('\n');
    if (mode === 'ask') {
      return `You are LOMVREN in Ask Mode. Answer questions clearly, accurately, and thoroughly about the workspace and code.
You have access to read-only tools to inspect the workspace before answering:
${toolList}

Inspect files when necessary to give accurate answers. Do NOT write or edit files. Always reference file names and line numbers.
Use clear Markdown headings, grouped bullet points, and fenced code blocks. For repository summaries, explain purpose, architecture, entry points, how to run/tests, and any gaps in inspection. Copy script commands exactly from the inspected scripts object instead of guessing what build or test does. Do not confuse devDependencies with runtime dependencies. A directory listing is not proof that you read every file. list_directory takes a directory path; read_file takes a file path.
When inspection is needed, invoke the offered read tool using a native function call or exactly this text protocol:
LOCALFORGE_TOOL_CALL {"tool":"read_file","arguments":{"path":"package.json"}}
Use the actual relevant path and tool arguments from the schema above. Wait for its tool result before describing what the file contains. Never invent an inspection result.`;
    }

    if (mode === 'plan') {
      return `You are LOMVREN in Plan Mode, acting as an expert software architect.
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

    return `You are LOMVREN, an autonomous software engineering assistant.
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
5. Reply using concise Markdown headings and bullet points: findings or changes, verification, and remaining blockers. Communicate useful progress in plain language, not tool JSON. For a read-only question, inspect and answer without preparing edits. Do not invent features or claim you inspected files you have not read.

Safety and accuracy:
- Workspace file tools take workspace-relative paths. Outside-workspace inspection is allowed only when Full Machine access explicitly grants the separate read_machine_file/list_machine_directory tools, and only after their approval. Never use a command to evade a denied permission.
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
    if (content.length > 8000) {
      const value = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
      const notice = 'Only the start and end of this tool output are shown. Use targeted paths, line windows or queries to inspect omitted content.';
      content = typeof value?.content === 'string'
        ? JSON.stringify({ ...value, content: value.content.slice(0, 2500) + '\n[Middle omitted]\n' + value.content.slice(-3500), truncated: true, notice })
        : JSON.stringify({ truncated: true, excerpt: content.slice(0, 3500) + '\n[Middle omitted]\n' + content.slice(-3500), notice });
    }
    history.push({ role: 'tool', tool_call_id: call.id, name, content });
  }

  private describeToolResultError(result: unknown): string | undefined {
    if (!result || typeof result !== 'object') return undefined;
    const value = result as Record<string, unknown>;
    if (typeof value.error === 'string' && value.error.trim()) return value.error;
    if (value.isError === true) return 'The tool reported an unsuccessful execution.';
    if (Array.isArray(value.files)) {
      const failures = value.files.filter((file) => file && typeof file === 'object' && typeof file.error === 'string');
      if (failures.length) return failures.map((file) => `${file.path ?? 'file'}: ${file.error}`).join('; ').slice(0, 1200);
    }
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
      return '## Progress\nThe model did not provide a final summary. The incomplete actions below explain what blocked this task.';
    }
    return 'The model returned an empty response. Try rephrasing your request or selecting another model.';
  }

  private addToolFailureNotice(response: string, state: AgentState): string {
    const cleaned = response.trim();
    if (!state.unresolvedErrors.length) return cleaned;

    const failures = [...new Set(state.unresolvedErrors)].map((failure) => `- ${failure.replace(/[\r\n]+/g, ' ').slice(0, 700)}`).join('\n');
    const failedTool = state.unresolvedErrors.some((error) => state.steps.some((step) => step.toolCalls.some((call) =>
      ['error', 'blocked'].includes(call.status) && (error.startsWith(`${call.name}:`) || call.status === 'blocked' && error.includes(call.name))
    )));
    const notice = `## Incomplete actions\n${failedTool ? 'Some tool actions failed; the task is not fully verified.' : 'The requested work is not fully verified.'}\n${failures}\n\nOnly successful inspections and command results count as verification. Proposed edits remain unapplied until approved.`;
    if (/^(?:the )?task (?:is )?completed[.!]?$/i.test(cleaned)) {
      return `I could not verify successful completion. ${notice}`;
    }
    if (!cleaned) return notice;
    return `${cleaned}\n\n${notice}`;
  }
}

function compactHistory(history: ChatMessage[], maximumCharacters: number, taskMessage?: ChatMessage): void {
  const size = () => history.reduce((total, message) => total + message.content.length + JSON.stringify(message.tool_calls ?? []).length, 0);
  if (size() <= maximumCharacters) return;
  const removed: string[] = [];
  while (history.length > 4 && size() > maximumCharacters) {
    const start = history[1] === taskMessage ? 2 : 1;
    let nextBoundary = start + 1;
    while (nextBoundary < history.length && history[nextBoundary].role === 'tool') nextBoundary += 1;
    if (nextBoundary >= history.length || history.slice(start, nextBoundary).includes(taskMessage!)) break;
    const group = history.splice(start, nextBoundary - start);
    for (const message of group) {
      if (message.role === 'tool') removed.push(`${message.name ?? 'tool'}: ${message.content.slice(0, 240)}`);
    }
  }
  if (removed.length) {
    history[0] = { ...history[0], content: history[0].content.split('\nPrevious tool evidence (abridged):')[0] + '\nPrevious tool evidence (abridged):\n' + removed.slice(-12).join('\n') + '\nEarlier tool results were compacted. Re-read relevant files before relying on omitted details.' };
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
