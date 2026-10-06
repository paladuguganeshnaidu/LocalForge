import * as vscode from 'vscode';
import { ChatMessage, ModelProvider } from '../providers/modelProvider';
import { AgentLoop, AgentLoopOptions, AgentMode, AgentState } from './agentLoop';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { ValidationEngine, ValidationAttempt } from './validationEngine';
import { EditEngine } from '../editing/editEngine';
import { getEditRequestPolicy } from '../editing/editRequestPolicy';
import { TerminalManager } from '../terminal/terminalManager';
import { validateCodingCompletion } from './completionEvidence';

export interface AgentRunSummary {
  runId: string;
  task: string;
  mode: AgentMode;
  response: string;
  filesModified: string[];
  validationAttempts: ValidationAttempt[];
  status: AgentState['status'];
  errors?: string[];
  durationMs: number;
}

export class AgentEngine {
  private validationEngine: ValidationEngine;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly editEngine?: EditEngine,
    terminalManager?: TerminalManager
  ) {
    this.validationEngine = new ValidationEngine(terminalManager);
  }

  public async runTask(
    provider: ModelProvider,
    model: string,
    messages: ChatMessage[],
    options: AgentLoopOptions = {},
    workspaceRoot?: vscode.Uri
  ): Promise<AgentRunSummary> {
    const policy = options.editRequestPolicy ?? getEditRequestPolicy(messages.at(-1)?.content ?? '');
    const run = () => this.runTaskWithPolicy(provider, model, messages, { ...options, editRequestPolicy: policy }, workspaceRoot);
    return this.editEngine ? this.editEngine.withRequestPolicy(policy, run) : run();
  }

  private async runTaskWithPolicy(
    provider: ModelProvider,
    model: string,
    messages: ChatMessage[],
    options: AgentLoopOptions,
    workspaceRoot?: vscode.Uri
  ): Promise<AgentRunSummary> {
    const loop = new AgentLoop(provider, this.toolRegistry, this.permissionManager);
    const startTime = Date.now();
    const validationAttempts: ValidationAttempt[] = [];
    const filesModified: string[] = [];

    // Run the main agent loop
    const { response, state } = await loop.run(model, messages, {
      ...options,
      validateFinalResponse: (answer, currentState) => options.validateFinalResponse?.(answer, currentState) || validateCodingCompletion(options.taskPrompt ?? messages.at(-1)?.content ?? '', currentState),
      onToolEnd: (name, result, error, id) => {
        if (['write_workspace_file', 'edit_workspace_file', 'write_file', 'create_file', 'replace_range', 'delete_file', 'move_file'].includes(name) && !error) {
          const res = result as { path?: string; from?: string; to?: string; applied?: boolean; success?: boolean; proposed?: boolean };
          if (res && !res.proposed && (res.applied || res.success !== false && res.success)) {
            for (const path of [res.path, res.from, res.to]) {
              if (path && !filesModified.includes(path)) filesModified.push(path);
            }
          }
        }
        options.onToolEnd?.(name, result, error, id);
      }
    });

    options.signal?.throwIfAborted();

    // If agent mode made file modifications that were auto-applied, run validation/repair loop
    if ((options.mode ?? 'agent') === 'agent' && state.status === 'completed' && filesModified.length > 0 && workspaceRoot && this.toolRegistry.isToolAllowed('run_command')) {
      const attempts = await this.validateAndRepair(
        provider,
        model,
        messages,
        response,
        filesModified,
        workspaceRoot,
        options
      );
      validationAttempts.push(...attempts);
    }

    const validationFailed = validationAttempts.length > 0 && !validationAttempts.at(-1)!.result.passed;
    const validationError = validationFailed ? `Verification failed: ${validationAttempts.at(-1)!.result.command}` : undefined;

    return {
      runId: state.runId,
      task: state.task,
      mode: state.mode,
      response: validationError ? `${response}\n\n${validationError}. Review the validation output before continuing.` : response,
      filesModified,
      validationAttempts,
      status: validationFailed ? 'failed' : state.status,
      errors: [...state.unresolvedErrors, ...(validationError ? [validationError] : [])],
      durationMs: Date.now() - startTime
    };
  }

  public async validateAndRepair(
    provider: ModelProvider,
    model: string,
    messages: ChatMessage[],
    lastResponse: string,
    filesModified: string[],
    workspaceRoot: vscode.Uri,
    options: AgentLoopOptions = {}
  ): Promise<ValidationAttempt[]> {
    const validationAttempts: ValidationAttempt[] = [];
    options.signal?.throwIfAborted();
    const projectInfo = await this.validationEngine.detectProject(workspaceRoot);
    options.signal?.throwIfAborted();
    if (!projectInfo.testCommand) return validationAttempts;

    const runValidation = async () => {
      options.signal?.throwIfAborted();
      const approved = await this.permissionManager.checkPermission('run_command', { command: projectInfo.testCommand }, false, options.signal);
      if (!approved) throw new Error(`Validation command was not approved: ${projectInfo.testCommand}`);
      options.signal?.throwIfAborted();
      return this.validationEngine.runValidation(workspaceRoot, projectInfo.testCommand, 60000, options.signal);
    };

    options.onProgress?.(`Validating changes with ${projectInfo.testCommand}...`);
    let currentResult = await runValidation();

    validationAttempts.push({
      attemptNumber: 1,
      action: projectInfo.testCommand,
      result: currentResult
    });

    let repairAttempt = 1;
    const maxRepairs = 3;

    while (!currentResult.passed && repairAttempt <= maxRepairs && !options.signal?.aborted) {
      options.onProgress?.(`Test failed. Repair ${repairAttempt} / ${maxRepairs}...`);

      const repairPrompt: ChatMessage = {
        role: 'user',
        content: `## TEST FAILURE — Systematic forensic diagnosis and surgical repair required.

**Validation Command**: \`${projectInfo.testCommand}\`
**Exit Code**: ${currentResult.exitCode}

### stdout:
\`\`\`
${currentResult.stdout}
\`\`\`

### stderr:
\`\`\`
${currentResult.stderr}
\`\`\`

## MANDATORY FORENSIC DEBUGGING PROTOCOL:
1. **ANALYZE THE FAILURE SPECIFICALLY**: Dissect the error payload above. Identify the exact failing test, assertion discrepancy (expected vs received value), and the precise source file and line number.
2. **TRACE TO ROOT CAUSE**: Trace backwards through the call stack to uncover the underlying flaw in your modified code (e.g., incorrect type, missing import, unhandled edge condition, off-by-one, race condition, or state mutation). Do not treat the symptom—isolate the cause.
3. **EXPLAIN THE FLAW**: Clearly state what caused the test failure in 1-2 concise sentences.
4. **EXECUTE SURGICAL REPAIR**: Apply an exact, production-ready fix to the affected file(s). Do NOT leave placeholders or TODOs. Do NOT rewrite unrelated code. Maintain full type safety and existing conventions.
5. **PREVENT REGRESSIONS**: Ensure your fix addresses the failure cleanly without compromising other features or test suites.

Do NOT guess. Do NOT make broad, speculative rewrites. Repair the identified root cause with surgical precision.`
      };

      const repairLoop = new AgentLoop(provider, this.toolRegistry, this.permissionManager);
      const repairRes = await repairLoop.run(
        model,
        [...messages, { role: 'assistant', content: lastResponse }, repairPrompt],
        {
          ...options,
          maxRounds: 4
        }
      );

      currentResult = await runValidation();
      repairAttempt += 1;
      validationAttempts.push({
        attemptNumber: repairAttempt,
        action: `Repair attempt: ${repairRes.response.slice(0, 100)}`,
        result: currentResult
      });
    }

    return validationAttempts;
  }
}
