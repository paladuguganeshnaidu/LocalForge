import * as vscode from 'vscode';
import { ModelProvider } from '../providers/modelProvider';
import { inferModelCapabilities } from '../providers/modelCapabilities';
import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';
import { AgentManager } from './orchestration/agentManager';
import { AgentPool } from './orchestration/agentPool';
import { AgentRole } from './orchestration/types';

export function registerSubagentTools(registry: ToolRegistry, permissions: PermissionManager, provider: ModelProvider, model: () => string | undefined, progress: (message: string) => void): void {
  const manager = new AgentManager(provider, registry, permissions, new AgentPool(1));
  const roles = ['planner', 'repository_analyst', 'reviewer', 'researcher'];
  registry.registerTool({ type: 'function', function: {
    name: 'delegate_task', description: 'Run a real read-only specialist using the selected model and current workspace. Roles: planner, repository_analyst, reviewer, researcher. Workers cannot edit, execute commands, recurse, change model or expand access. Internet/sensitive reads still require approval. Returns actual inspection results and a written handoff, not a certified project build.',
    parameters: { type: 'object', properties: { role: { type: 'string', enum: roles }, task: { type: 'string', minLength: 1, maxLength: 4000 } }, required: ['role', 'task'], additionalProperties: false }
  } }, async (args, execution) => {
    if (typeof args.role !== 'string' || !roles.includes(args.role) || typeof args.task !== 'string' || !args.task.trim() || args.task.length > 4000) throw new Error('Provide a supported read-only role and a task of 1 to 4000 characters.');
    const selected = model();
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root || !selected) throw new Error('Open a workspace and select a reachable model before delegation.');
    const evidence: Array<{ tool: string; result: unknown; error?: string }> = [];
    const speak = (message: string) => { if (!execution.signal.aborted) progress(`Subagent ${args.role}: ${message}`); };
    const result = await manager.executeSubagent({ agentId: `delegate-${Date.now()}`, role: args.role as AgentRole, task: args.task, workspaceRoot: root, relevantFiles: [], modelCapabilities: inferModelCapabilities(selected), toolPermissions: ['read'], signal: execution.signal, budget: { maxTokens: 4000, maxRounds: 20, maxToolCalls: 4, timeoutMs: 600000, retryLimit: 0 } }, selected, {
      requireToolUse: args.role !== 'planner', excludedTools: ['delegate_task', 'register_workflow_tool'], onProgress: speak,
      onToolEnd: (name, output, error) => { evidence.push({ tool: name, result: output, error }); }
    });
    return { success: result.status === 'completed', model: selected, role: args.role, readOnly: true, output: result.output, status: result.status, error: result.error, inspections: evidence };
  }, { timeout: 660000 });
}
