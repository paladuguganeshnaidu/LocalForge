import { validateWorkspaceRelativePath } from '../core/workspacePaths';

export type AccessScope = 'workspace' | 'file' | 'machine';

export function isAccessScope(value: unknown): value is AccessScope {
  return value === 'workspace' || value === 'file' || value === 'machine';
}

const fileTools = new Set(['read_file', 'read_workspace_file', 'read_files', 'write_file', 'write_workspace_file', 'edit_workspace_file', 'create_file', 'replace_range', 'delete_file', 'read_web_page']);

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

  public allowsTool(name: string): boolean {
    if (name === 'read_machine_file' || name === 'list_machine_directory') return this.scope === 'machine';
    return this.scope !== 'file' || fileTools.has(name);
  }

  public assertTool(name: string, args: Record<string, unknown>): void {
    if (!this.allowsTool(name)) throw new Error(`"${name}" is unavailable with ${this.scope === 'file' ? 'File' : 'Project workspace'} access. Change the access scope explicitly to authorize it.`);
    if (this.scope !== 'file' || name === 'read_web_page') return;
    const paths = name === 'read_files' ? args.paths : [args.path];
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
    if (this.scope === 'file') return `Access scope: File. Only ${this.filePath} is authorized. No repository search, other files, terminal, Git or delegation is permitted. Read that file through read_file. Network documentation still requires explicit approval.`;
    if (this.scope === 'machine') return 'Access scope: Full Machine, at the current OS user privileges only. Workspace edit tools still use workspace-relative paths and reviewable diffs. For outside-workspace inspection use read_machine_file or list_machine_directory with an absolute path; each requires approval. No OS sandbox or administrator privileges are granted. Shell commands require the command permission policy; never use them to evade denied file or network access.';
    return 'Access scope: Project workspace. Built-in file tools are restricted to the open workspace. Commands run as the current OS user and are not OS-sandboxed; command approval is separate. Internet documentation requires explicit approval.';
  }
}
