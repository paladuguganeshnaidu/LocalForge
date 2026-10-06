import { validateWorkspaceRelativePath } from '../core/workspacePaths';
import { getBuiltinToolDescriptor, ToolDescriptor } from './toolPolicy';

export type AccessScope = 'workspace' | 'file' | 'machine';

export function isAccessScope(value: unknown): value is AccessScope {
  return value === 'workspace' || value === 'file' || value === 'machine';
}

export class AgentAccessPolicy {
  private scope: AccessScope = 'workspace';
  private filePath?: string;

  public getState(): { scope: AccessScope; filePath?: string } {
    return { scope: this.scope, filePath: this.filePath };
  }

  public setScope(scope: AccessScope, filePath?: string): void {
    if (scope === 'file') {
      if (!filePath) throw new Error('Choose a workspace file before enabling File access.');
      validateWorkspaceRelativePath(filePath);
    }
    this.scope = scope;
    this.filePath = scope === 'file' ? filePath : undefined;
  }

  public allowsTool(name: string, descriptor = getBuiltinToolDescriptor(name)): boolean {
    return !!descriptor && descriptor.name === name && descriptor.scopes.includes(this.scope);
  }

  public assertTool(name: string, args: Record<string, unknown>, descriptor?: ToolDescriptor): void {
    const policy = descriptor ?? getBuiltinToolDescriptor(name);
    if (!this.allowsTool(name, policy)) throw new Error(`"${name}" is unavailable with ${this.scope === 'file' ? 'File' : 'Project workspace'} access. Change the access scope explicitly to authorize it.`);
    if (this.scope !== 'file' || !policy!.pathArguments.length) return;
    const paths = policy!.pathArguments.flatMap((key) => Array.isArray(args[key]) ? args[key] as unknown[] : [args[key]]);
    if (!Array.isArray(paths) || !paths.length) throw new Error('File access requires the selected file path.');
    for (const filePath of paths) this.assertFile(filePath);
  }

  public assertFile(filePath: unknown): void {
    if (this.scope !== 'file') return;
    if (typeof filePath !== 'string') throw new Error('File access requires a file path string.');
    const normalized = validateWorkspaceRelativePath(filePath).join('/');
    const selected = validateWorkspaceRelativePath(this.filePath!).join('/');
    const compare = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
    if (compare(normalized) !== compare(selected)) throw new Error(`File access is restricted to "${this.filePath}". Access to "${filePath}" was blocked.`);
  }

  public getPrompt(): string {
    if (this.scope === 'file') return `STRICT ACCESS SCOPE: File-only mode.\nAuthorized file: ${this.filePath}\nYou may ONLY read and propose edits to this single file using read_file or editing tools. All other operations are BLOCKED: no broad repository search, no other file access, no terminal commands, no Git operations, no subagent delegation. External documentation requires explicit approval. Maximize quality within this file: inspect its full imports, types, and logic, and provide complete, robust, production-ready edits with zero placeholders.`;
    if (this.scope === 'machine') return 'ACCESS SCOPE: Full Machine (current OS user privileges only).\nWorkspace edit tools operate with reviewable diffs. For outside-workspace inspection, use read_machine_file or list_machine_directory with absolute paths — each requires separate explicit approval. CONSTRAINTS: No administrator privileges are granted. No OS sandbox is active. Shell commands require explicit permission policy approval. Proactively verify system environments, configs, and dependencies without evading security boundaries.';
    return 'ACCESS SCOPE: Project workspace.\nBuilt-in file tools have full access across the open workspace folder. Inspect project structure, manifests, and source files aggressively. Shell commands run as the current OS user and are NOT OS-sandboxed — command approval is managed by permission policy. External network/documentation access requires explicit approval. Deliver complete, verified, production-grade solutions respecting these boundaries.';
  }
}
