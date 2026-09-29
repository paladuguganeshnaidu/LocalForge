import * as vscode from 'vscode';
import { ChatMessage, ModelProvider } from '../providers/modelProvider';
import { AgentLoop, AgentLoopOptions, AgentMode, AgentState } from './agentLoop';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { ValidationEngine, ValidationAttempt } from './validationEngine';
import { EditEngine } from '../editing/editEngine';

export interface AgentRunSummary {
  runId: string;
  task: string;
  mode: AgentMode;
  response: string;
  filesModified: string[];
  validationAttempts: ValidationAttempt[];
  status: AgentState['status'];
  durationMs: number;
}

export class AgentEngine {
  private validationEngine: ValidationEngine;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionManager: PermissionManager,
    private readonly editEngine?: EditEngine
  ) {
    this.validationEngine = new ValidationEngine();
  }

  public async runTask(
    provider: ModelProvider,
    model: string,
    messages: ChatMessage[],
    options: AgentLoopOptions = {},
    workspaceRoot?: vscode.Uri
  ): Promise<AgentRunSummary> {
    const loop = new AgentLoop(provider, this.toolRegistry, this.permissionManager);
    const startTime = Date.now();
    const validationAttempts: ValidationAttempt[] = [];
    const filesModified: string[] = [];

    // Run the main agent loop
    const { response, state } = await loop.run(model, messages, {
      ...options,
      onToolEnd: (name, result, error, id) => {
        if ((name === 'write_workspace_file' || name === 'edit_workspace_file') && !error) {
          const res = result as { path?: string; applied?: boolean; success?: boolean; proposed?: boolean };
          if (res?.path && !res.proposed && (res.applied || res.success) && !filesModified.includes(res.path)) {
            filesModified.push(res.path);
          }
        }
        options.onToolEnd?.(name, result, error, id);
      }
    });

    // If agent mode made file modifications that were auto-applied, run validation/repair loop
    if (options.mode === 'agent' && filesModified.length > 0 && workspaceRoot) {
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

    return {
      runId: state.runId,
      task: state.task,
      mode: state.mode,
      response,
      filesModified,
      validationAttempts,
      status: state.status,
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
    const projectInfo = await this.validationEngine.detectProject(workspaceRoot);
    if (!projectInfo.testCommand) return validationAttempts;

    options.onProgress?.(`Validating changes with ${projectInfo.testCommand}...`);
    let currentResult = await this.validationEngine.runValidation(workspaceRoot, projectInfo.testCommand);

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
        content: `The tests failed after your modifications:\nCommand: ${projectInfo.testCommand}\nExit code: ${currentResult.exitCode}\nOutput:\n${currentResult.stdout}\n${currentResult.stderr}\n\nPlease analyze the failure and repair the code now.`
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

      currentResult = await this.validationEngine.runValidation(workspaceRoot, projectInfo.testCommand);
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
