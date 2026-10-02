import { ModelToolDefinition } from '../providers/modelProvider';
import { PermissionManager, ToolCategory } from './permissionManager';
import { withCancellation } from '../core/cancellation';
import { AgentAccessPolicy } from './accessPolicy';

export interface ToolExecutionContext {
  signal: AbortSignal;
}

export interface ToolExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ToolRiskLevel =
  | 'read_only'
  | 'low_risk'
  | 'high_risk'
  | 'destructive'
  | 'network'
  | 'privileged';

export interface RegisteredTool {
  name: string;
  description: string;
  definition: ModelToolDefinition;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  permissionRequired?: boolean;
  capabilitiesRequired?: string[];
  handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  validate?: (args: Record<string, unknown>) => void;
  redact?: (result: unknown) => unknown;
  timeout?: number;
  retryPolicy?: { maxRetries: number; retryableErrors?: string[] };
  source?: 'builtin' | 'mcp' | 'custom';
}

export interface RegisterToolOptions {
  category?: ToolCategory;
  riskLevel?: ToolRiskLevel;
  requiresApproval?: boolean;
  permissionRequired?: boolean;
  capabilitiesRequired?: string[];
  validate?: (args: Record<string, unknown>) => void;
  redact?: (result: unknown) => unknown;
  timeout?: number;
  retryPolicy?: { maxRetries: number; retryableErrors?: string[] };
  source?: 'builtin' | 'mcp' | 'custom';
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private accessPolicy?: AgentAccessPolicy;

  public setAccessPolicy(policy: AgentAccessPolicy): void {
    this.accessPolicy = policy;
  }

  public isToolAllowed(name: string): boolean {
    return !this.accessPolicy || this.accessPolicy.allowsTool(name);
  }

  public registerTool(
    definition: ModelToolDefinition,
    handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>,
    categoryOrOptions?: ToolCategory | RegisterToolOptions,
    source: 'builtin' | 'mcp' | 'custom' = 'builtin'
  ): void {
    const name = definition.function.name;
    const desc = definition.function.description || '';

    let cat: ToolCategory;
    let risk: ToolRiskLevel;
    let requiresApproval = false;
    let capabilitiesRequired: string[] | undefined;
    let validate: ((args: Record<string, unknown>) => void) | undefined;
    let redact: ((result: unknown) => unknown) | undefined;
    let timeout: number | undefined;
    let retryPolicy: { maxRetries: number; retryableErrors?: string[] } | undefined;
    let src = source;

    if (typeof categoryOrOptions === 'string') {
      cat = categoryOrOptions;
      risk = this.inferRiskLevel(name, cat);
      requiresApproval = cat === 'execute' || cat === 'edit';
    } else if (categoryOrOptions && typeof categoryOrOptions === 'object') {
      cat = categoryOrOptions.category || this.inferCategory(name);
      risk = categoryOrOptions.riskLevel || this.inferRiskLevel(name, cat);
      requiresApproval = categoryOrOptions.requiresApproval ?? (risk === 'high_risk' || risk === 'destructive' || risk === 'privileged');
      capabilitiesRequired = categoryOrOptions.capabilitiesRequired;
      validate = categoryOrOptions.validate;
      redact = categoryOrOptions.redact;
      timeout = categoryOrOptions.timeout;
      retryPolicy = categoryOrOptions.retryPolicy;
      src = categoryOrOptions.source || source;
    } else {
      cat = this.inferCategory(name);
      risk = this.inferRiskLevel(name, cat);
      requiresApproval = cat === 'execute' || cat === 'edit';
    }

    this.tools.set(name, {
      name,
      description: desc,
      definition,
      category: cat,
      riskLevel: risk,
      requiresApproval,
      permissionRequired: typeof categoryOrOptions === 'object' ? categoryOrOptions.permissionRequired : undefined,
      capabilitiesRequired,
      handler,
      validate,
      redact,
      timeout,
      retryPolicy,
      source: src
    });
  }

  public unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  public getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public getAllTools(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  public getDefinitions(categoryFilter?: ToolCategory): ModelToolDefinition[] {
    const list: ModelToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if ((!categoryFilter || tool.category === categoryFilter) && (!this.accessPolicy || this.accessPolicy.allowsTool(tool.name))) {
        list.push(tool.definition);
      }
    }
    return list;
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    permissionManager?: PermissionManager,
    options: ToolExecutionOptions = {}
  ): Promise<unknown> {
    options.signal?.throwIfAborted();
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool “${name}” is not allow-listed or registered.`);
    }

    this.accessPolicy?.assertTool(name, args);
    if (tool.permissionRequired && !permissionManager) throw new Error('Explicit access approval requires an interactive permission manager.');

    if (tool.validate) {
      tool.validate(args);
    }

    if (permissionManager) {
      const trustedBuiltinReadOnly = tool.source === 'builtin' &&
        tool.category === 'read' && tool.riskLevel === 'read_only' && !tool.requiresApproval;
      const requireExplicitApproval = tool.requiresApproval && ['high_risk', 'destructive', 'privileged', 'network'].includes(tool.riskLevel);
      const allowed = await permissionManager.checkPermission(name, args, trustedBuiltinReadOnly, options.signal, requireExplicitApproval);
      options.signal?.throwIfAborted();
      if (!allowed) {
        throw new Error(`Execution of tool “${name}” was rejected by user or permission policy.`);
      }
    }

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timeoutMs = tool.timeout ?? options.timeoutMs;
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(new DOMException(`Tool "${name}" execution timed out after ${timeoutMs}ms.`, 'TimeoutError')), timeoutMs);
    }
    try {
      controller.signal.throwIfAborted();
      const result = await withCancellation(tool.handler(args, { signal: controller.signal }), controller.signal);
      controller.signal.throwIfAborted();
      return tool.redact ? tool.redact(result) : result;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

  private inferCategory(name: string): ToolCategory {
    if (
      name.startsWith('read_') ||
      name.startsWith('search_') ||
      name.startsWith('list_') ||
      name.startsWith('get_') ||
      name.startsWith('detect_') ||
      name.startsWith('inspect_') ||
      name === 'git_status' ||
      name === 'git_diff' ||
      name === 'git_log' ||
      name === 'git_show' ||
      name === 'workspace_search' ||
      name === 'symbol_search'
    ) {
      return 'read';
    }
    if (
      name.startsWith('write_') ||
      name.startsWith('edit_') ||
      name.startsWith('create_') ||
      name.startsWith('delete_') ||
      name.startsWith('move_') ||
      name.startsWith('rename_') ||
      name.startsWith('apply_') ||
      name.startsWith('replace_') ||
      name === 'git_restore' ||
      name === 'git_checkout' ||
      name === 'create_artifact'
    ) {
      return 'edit';
    }
    return 'execute';
  }

  private inferRiskLevel(name: string, category: ToolCategory): ToolRiskLevel {
    if (category === 'read') return 'read_only';
    if (name.startsWith('delete_') || name.includes('catastrophic') || name.includes('drop')) return 'destructive';
    if (name === 'run_command' || name === 'run_test' || name === 'run_build') return 'low_risk';
    if (name.startsWith('browser_')) return 'network';
    if (category === 'edit') return 'low_risk';
    return 'high_risk';
  }
}
