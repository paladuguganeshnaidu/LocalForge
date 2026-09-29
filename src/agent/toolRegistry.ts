import { ModelToolDefinition } from '../providers/modelProvider';
import { PermissionManager, ToolCategory } from './permissionManager';

export interface RegisteredTool {
  definition: ModelToolDefinition;
  category: ToolCategory;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
  source?: 'builtin' | 'mcp' | 'custom';
}

export type EditProposalHandler = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private editProposalHandler?: EditProposalHandler;

  public setEditProposalHandler(handler?: EditProposalHandler): void {
    this.editProposalHandler = handler;
  }

  public registerTool(
    definition: ModelToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<unknown>,
    category?: ToolCategory,
    source: 'builtin' | 'mcp' | 'custom' = 'builtin'
  ): void {
    const name = definition.function.name;
    const cat = category || this.inferCategory(name);
    this.tools.set(name, {
      definition,
      category: cat,
      handler,
      source
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
    if (!tool) {
      throw new Error(`Tool “${name}” is not allow-listed or registered.`);
    }

    if (this.editProposalHandler && (name === 'write_workspace_file' || name === 'edit_workspace_file')) {
      return this.editProposalHandler(name, args);
    }

    if (permissionManager) {
      const allowed = await permissionManager.checkPermission(name, args);
      if (!allowed) {
        throw new Error(`Execution of tool “${name}” was rejected by user or permission policy.`);
      }
    }

    return await tool.handler(args);
  }

  private inferCategory(name: string): ToolCategory {
    if (name.startsWith('read_') || name.startsWith('search_') || name.startsWith('list_') || name === 'git_status' || name === 'git_diff' || name === 'detect_project') {
      return 'read';
    }
    if (name.startsWith('write_') || name.startsWith('edit_') || name.startsWith('delete_') || name.startsWith('apply_patch')) {
      return 'edit';
    }
    return 'execute';
  }
}
