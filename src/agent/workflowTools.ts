import { ToolRegistry } from './toolRegistry';
import { PermissionManager } from './permissionManager';

interface WorkflowStep { tool: string; args: Record<string, unknown>; authorizationId: string }

export function registerWorkflowTools(registry: ToolRegistry, permissions: PermissionManager): void {
  const parse = (args: Record<string, unknown>) => {
    if (typeof args.name !== 'string' || !/^workflow_[a-z][a-z0-9_]{2,63}$/.test(args.name) || registry.hasTool(args.name)) throw new Error('Use an unused workflow_ name with lowercase letters, digits and underscores. Existing tools cannot be replaced.');
    if (typeof args.description !== 'string' || !args.description.trim() || args.description.length > 500) throw new Error('Provide a description of 1 to 500 characters.');
    if (!Array.isArray(args.steps) || args.steps.length < 2 || args.steps.length > 10 || JSON.stringify(args.steps).length > 20000) throw new Error('A workflow needs 2 to 10 bounded steps, not an alias for one operation.');
    const steps = args.steps.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each step must contain tool and args.');
      const step = value as Record<string, unknown>;
      if (typeof step.tool !== 'string' || !step.args || typeof step.args !== 'object' || Array.isArray(step.args) || Object.keys(step).some(key => !['tool', 'args'].includes(key))) throw new Error('Each step needs an exact tool name and object args.');
      const tool = registry.getTool(step.tool);
      if (!tool || tool.source !== 'builtin' || !registry.isToolAllowed(step.tool) || ['register_workflow_tool', 'delegate_task'].includes(step.tool)) throw new Error('Workflow steps must reference currently allowed built-in tools; recursive workflows and delegation are not allowed.');
      return { tool: step.tool, args: structuredClone(step.args as Record<string, unknown>), authorizationId: tool.authorizationId };
    });
    if (new Set(steps.map(step => step.tool)).size < 2) throw new Error('A workflow must combine at least two different real operations.');
    return { name: args.name, description: args.description, steps };
  };
  registry.registerTool({ type: 'function', function: {
    name: 'register_workflow_tool', description: 'With explicit approval, register a temporary named workflow combining 2–10 different existing built-in operations. No eval, scripts, aliases, replacements or persistence. Each invocation and each protected child operation retain normal permissions. Discover the exact new name on the next turn before using it.',
    parameters: { type: 'object', properties: { name: { type: 'string', pattern: '^workflow_[a-z][a-z0-9_]{2,63}$' }, description: { type: 'string', minLength: 1, maxLength: 500 }, steps: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool', 'args'], additionalProperties: false } } }, required: ['name', 'description', 'steps'], additionalProperties: false }
  } }, async (args, execution) => {
    const recipe = parse(args);
    if (JSON.stringify(recipe) !== execution.approvedArguments?.recipe) throw new Error('The workflow or its registered handlers changed after approval; nothing was registered.');
    const steps: WorkflowStep[] = recipe.steps;
    registry.registerTool({ type: 'function', function: { name: recipe.name, description: recipe.description, parameters: { type: 'object', properties: {}, additionalProperties: false } } }, async (input, childExecution) => {
      if (Object.keys(input).length) throw new Error('This approved workflow has fixed arguments; do not add parameters.');
      const results: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];
      for (const step of steps) {
        childExecution.signal.throwIfAborted();
        if (registry.getTool(step.tool)?.authorizationId !== step.authorizationId) throw new Error('A workflow handler was replaced. Register and approve a fresh workflow.');
        const result = await registry.executeTool(step.tool, structuredClone(step.args), permissions, { signal: childExecution.signal, timeoutMs: 60000 });
        results.push({ tool: step.tool, args: step.args, result });
        const outcome = result && typeof result === 'object' ? result as Record<string, unknown> : {};
        if (outcome.success === false || outcome.error || ['failed', 'timed_out', 'stopped', 'cancelled'].includes(String(outcome.status)) || typeof outcome.exitCode === 'number' && outcome.exitCode !== 0 || outcome.proposed === true || outcome.requiresUserAction === true) return { success: false, results, error: 'The workflow stopped at a failed, cancelled or pending-review step. No later operation executed.' };
      }
      return { success: true, results };
    }, { source: 'custom', timeout: 900000, descriptor: { name: recipe.name, category: 'execute', riskLevel: 'high_risk', mutability: 'workspace', scopes: ['workspace'], approval: 'explicit', pathArguments: [], network: steps.some(step => registry.getTool(step.tool)?.descriptor.network), processExecution: steps.some(step => registry.getTool(step.tool)?.descriptor.processExecution), reviewable: false, reversible: false, activity: 'Working' } });
    return { registered: true, name: recipe.name, temporary: true, independentBuiltinTool: false, message: 'Registered for this extension host only. Discover this exact name before invoking it. Normal approval and child permissions still apply.' };
  }, { validate: args => { parse(args); }, prepareApproval: async args => ({ ...args, recipe: JSON.stringify(parse(args)) }) });
}
