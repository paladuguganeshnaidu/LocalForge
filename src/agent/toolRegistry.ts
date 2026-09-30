import { ModelToolDefinition } from '../providers/modelProvider';
import { PermissionManager, ToolCategory } from './permissionManager';
import { assertAllowedCommand } from '../security/commandPolicy';
import { redactUnknown } from '../security/secretRedactor';

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
  capabilitiesRequired?: string[];
  handler: (args: Record<string, unknown>) => Promise<unknown>;
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
  capabilitiesRequired?: string[];
  validate?: (args: Record<string, unknown>) => void;
  redact?: (result: unknown) => unknown;
  timeout?: number;
  retryPolicy?: { maxRetries: number; retryableErrors?: string[] };
  source?: 'builtin' | 'mcp' | 'custom';
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private auditTrail: Array<{ timestamp: number; tool: string; status: 'started' | 'completed' | 'failed'; risk: ToolRiskLevel; error?: string }> = [];

  private audit(event: { tool: string; status: 'started' | 'completed' | 'failed'; risk: ToolRiskLevel; error?: string }): void {
    this.auditTrail.push({ timestamp: Date.now(), ...event });
    if (this.auditTrail.length > 500) this.auditTrail.splice(0, this.auditTrail.length - 500);
  }

  public getAuditTrail(): ReadonlyArray<{ timestamp: number; tool: string; status: 'started' | 'completed' | 'failed'; risk: ToolRiskLevel; error?: string }> {
    return this.auditTrail;
  }

  public registerTool(
    definition: ModelToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
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
      if (!categoryFilter || tool.category === categoryFilter) {
        list.push(tool.definition);
      }
    }
    return list;
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    permissionManager?: PermissionManager
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error('Tool "' + name + '" is not allow-listed or registered.');

    if (tool.validate) tool.validate(args);

    if (typeof args.command === 'string') {
      assertAllowedCommand(args.command);
    }

    this.audit({ tool: name, status: 'started', risk: tool.riskLevel });

    try {
      if (permissionManager) {
        const allowed = await permissionManager.checkPermission(name, args);
        if (!allowed) throw new Error('Execution of tool "' + name + '" was rejected by user or permission policy.');
      }

      let result: unknown;
      if (tool.timeout && tool.timeout > 0) {
        let timer: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Tool "' + name + '" execution timed out after ' + tool.timeout + 'ms.')), tool.timeout);
        });
        try {
          result = await Promise.race([tool.handler(args), timeoutPromise]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      } else {
        result = await tool.handler(args);
      }

      if (tool.redact) result = tool.redact(result);
      const safe = redactUnknown(result);
      this.audit({ tool: name, status: 'completed', risk: tool.riskLevel });
      return safe;
    } catch (error: any) {
      this.audit({ tool: name, status: 'failed', risk: tool.riskLevel, error: String(error?.message || error) });
      throw error;
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
