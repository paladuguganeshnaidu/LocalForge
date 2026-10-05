import { ModelToolDefinition } from '../providers/modelProvider';
import { PermissionManager, ToolCategory } from './permissionManager';
import { withCancellation } from '../core/cancellation';
import { AgentAccessPolicy } from './accessPolicy';
import { describeExternalTool, freezeToolDescriptor, getBuiltinToolDescriptor, ToolDescriptor, ToolRiskLevel, validateToolDescriptor } from './toolPolicy';

export interface ToolExecutionContext {
  signal: AbortSignal;
  approvedArguments?: Record<string, unknown>;
}

export interface ToolExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type { ToolRiskLevel } from './toolPolicy';

let registrationSequence = 0;

export interface RegisteredTool {
  name: string;
  description: string;
  definition: ModelToolDefinition;
  category: ToolCategory;
  descriptor: ToolDescriptor;
  authorizationId: string;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  permissionRequired?: boolean;
  capabilitiesRequired?: string[];
  handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  prepareApproval?: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  validate?: (args: Record<string, unknown>) => void;
  redact?: (result: unknown) => unknown;
  timeout?: number;
  retryPolicy?: { maxRetries: number; retryableErrors?: string[] };
  source?: 'builtin' | 'mcp' | 'custom';
}

export interface RegisterToolOptions {
  prepareApproval?: RegisteredTool['prepareApproval'];
  descriptor?: ToolDescriptor;
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
    const tool = this.tools.get(name);
    return !!tool && (!this.accessPolicy || this.accessPolicy.allowsTool(name, tool.descriptor));
  }

  public registerTool(
    definition: ModelToolDefinition,
    handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>,
    categoryOrOptions?: ToolCategory | RegisterToolOptions,
    source: 'builtin' | 'mcp' | 'custom' = 'builtin'
  ): void {
    const name = definition?.function?.name;
    if (this.tools.has(name)) throw new Error(`Duplicate tool registration: ${name}. Use replaceTool explicitly.`);
    this.tools.set(name, this.makeRegisteredTool(definition, handler, categoryOrOptions, source));
  }

  public replaceTool(definition: ModelToolDefinition, handler: RegisteredTool['handler'], options?: ToolCategory | RegisterToolOptions, source: 'builtin' | 'mcp' | 'custom' = 'builtin'): void {
    if (!this.tools.has(definition.function.name)) throw new Error('Only an already registered tool can be explicitly replaced.');
    const replacement = this.makeRegisteredTool(definition, handler, options, source);
    this.tools.set(replacement.name, replacement);
  }

  private makeRegisteredTool(definition: ModelToolDefinition, handler: RegisteredTool['handler'], options?: ToolCategory | RegisterToolOptions, source: 'builtin' | 'mcp' | 'custom' = 'builtin'): RegisteredTool {
    const name = definition?.function?.name;
    if (definition?.type !== 'function' || typeof definition.function.description !== 'string' || !definition.function.description.trim() || !definition.function.parameters || typeof definition.function.parameters !== 'object' || Array.isArray(definition.function.parameters) || typeof handler !== 'function') throw new Error('Tools require a function definition, description, parameter schema and handler.');
    const settings: RegisterToolOptions = typeof options === 'string' ? { category: options } : options ?? {};
    const builtin = getBuiltinToolDescriptor(name);
    if (builtin && settings.category && settings.category !== builtin.category) throw new Error(`Tool category disagrees with canonical policy: ${name}`);
    if (builtin && settings.descriptor && JSON.stringify(settings.descriptor) !== JSON.stringify(builtin)) throw new Error(`Built-in tool policy cannot be replaced: ${name}`);
    let descriptor = builtin ?? settings.descriptor ?? describeExternalTool(name, settings.category);
    const resolvedSource = settings.source ?? (builtin || options ? source : 'custom');
    if (builtin && resolvedSource !== 'builtin') throw new Error('External tools must use distinct names, not reserved built-in identities.');
    if (!builtin && !settings.descriptor && settings.category && resolvedSource === 'builtin' && settings.riskLevel === 'read_only' && settings.requiresApproval === false) {
      descriptor = freezeToolDescriptor({ ...descriptor, category: 'read', riskLevel: 'read_only', mutability: 'none', approval: 'read_only', processExecution: false });
    }
    if (descriptor.name !== name) throw new Error('Tool descriptor identity must match the function identity.');
    if (settings.permissionRequired === true || settings.requiresApproval === true || resolvedSource !== 'builtin') descriptor = { ...descriptor, approval: 'explicit' };
    descriptor = freezeToolDescriptor(descriptor);
    if (!['builtin', 'mcp', 'custom'].includes(resolvedSource)) throw new Error('Invalid tool provenance.');
    if (settings.timeout !== undefined && (!Number.isFinite(settings.timeout) || settings.timeout <= 0)) throw new Error('Tool timeout must be a positive finite number.');
    const schema = structuredClone(definition);
    return Object.freeze({ name, description: schema.function.description, definition: schema, descriptor, authorizationId: 'registration-' + ++registrationSequence, category: descriptor.category, riskLevel: descriptor.riskLevel, requiresApproval: descriptor.approval !== 'read_only', permissionRequired: descriptor.approval === 'explicit' || settings.permissionRequired === true || resolvedSource !== 'builtin', capabilitiesRequired: settings.capabilitiesRequired, handler, prepareApproval: settings.prepareApproval, validate: settings.validate, redact: settings.redact, timeout: settings.timeout, retryPolicy: settings.retryPolicy, source: resolvedSource });
  }

  public createScopedRegistry(categories: readonly ToolCategory[]): ToolRegistry {
    const scoped = new ToolRegistry();
    scoped.accessPolicy = this.accessPolicy;
    for (const tool of this.tools.values()) if (categories.includes(tool.category) && this.isToolAllowed(tool.name)) scoped.tools.set(tool.name, tool);
    return scoped;
  }

  public assertInvariants(): void {
    for (const [name, tool] of this.tools) {
      validateToolDescriptor(tool.descriptor);
      if (name !== tool.name || name !== tool.definition.function.name || name !== tool.descriptor.name || typeof tool.handler !== 'function' || !tool.description || tool.category !== tool.descriptor.category || tool.riskLevel !== tool.descriptor.riskLevel) throw new Error(`Invalid registered tool: ${name}`);
    }
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
      if ((!categoryFilter || tool.category === categoryFilter) && this.isToolAllowed(tool.name)) {
        list.push(structuredClone(tool.definition));
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

    this.accessPolicy?.assertTool(name, args, tool.descriptor);
    if (tool.permissionRequired && !permissionManager) throw new Error('Explicit access approval requires an interactive permission manager.');

    if (tool.validate) {
      tool.validate(args);
    }

    const approvedArguments = tool.prepareApproval ? await withCancellation(tool.prepareApproval(args, options.signal), options.signal) : args;
    options.signal?.throwIfAborted();
    if (!approvedArguments || typeof approvedArguments !== 'object' || Array.isArray(approvedArguments)) throw new Error('Prepared approval arguments must be an object.');
    if (permissionManager) {
      const trustedBuiltinReadOnly = tool.source === 'builtin' && tool.descriptor.approval === 'read_only';
      const requireExplicitApproval = tool.descriptor.approval === 'explicit';
      const allowed = await permissionManager.checkPermission(name, approvedArguments, trustedBuiltinReadOnly, options.signal, requireExplicitApproval, tool.descriptor, tool.authorizationId);
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
      const result = await withCancellation(tool.handler(args, { signal: controller.signal, approvedArguments }), controller.signal);
      controller.signal.throwIfAborted();
      return tool.redact ? tool.redact(result) : result;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }

}
