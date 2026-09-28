export type ToolCategory = 'read' | 'edit' | 'execute';
export type PermissionMode = 'always_ask' | 'ask_once_per_session' | 'allow_safe_auto';

export interface PermissionRequest {
  id: string;
  toolName: string;
  category: ToolCategory;
  description: string;
  command?: string;
  path?: string;
  args?: Record<string, unknown>;
}

export type ApprovalHandler = (request: PermissionRequest) => Promise<boolean>;

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+[\/\\]/i,
  /\bdel\s+.*[a-z]:\\/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd[a-z]/i,
  /\bshutdown\b/i,
  /\breboot\b/i
];

const SAFE_READ_COMMAND_PREFIXES = [
  'git status',
  'git diff',
  'git log',
  'git branch',
  'npm test',
  'npm run test',
  'npm run lint',
  'npm run build',
  'cargo check',
  'cargo test',
  'pytest',
  'go test',
  'python -m unittest'
];

export class PermissionManager {
  private mode: PermissionMode = 'allow_safe_auto';
  private sessionApprovedTools = new Set<string>();
  private approvalHandler?: ApprovalHandler;

  constructor(mode: PermissionMode = 'allow_safe_auto', approvalHandler?: ApprovalHandler) {
    this.mode = mode;
    this.approvalHandler = approvalHandler;
  }

  public setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  public getMode(): PermissionMode {
    return this.mode;
  }

  public setApprovalHandler(handler: ApprovalHandler): void {
    this.approvalHandler = handler;
  }

  public clearSession(): void {
    this.sessionApprovedTools.clear();
  }

  public classifyTool(toolName: string): ToolCategory {
    if (toolName.startsWith('read_') || toolName.startsWith('search_') || toolName.startsWith('list_') || toolName === 'git_status' || toolName === 'git_diff' || toolName === 'detect_project') {
      return 'read';
    }
    if (toolName.startsWith('write_') || toolName.startsWith('edit_') || toolName.startsWith('delete_') || toolName.startsWith('apply_patch')) {
      return 'edit';
    }
    return 'execute';
  }

  public validateCommandSafety(command: string): void {
    const normalized = command.trim().toLowerCase();
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
      if (pattern.test(normalized)) {
        throw new Error('Command contains potentially catastrophic system operations and was blocked by policy.');
      }
    }
  }

  public isSafeCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    try {
      this.validateCommandSafety(command);
    } catch {
      return false;
    }
    return SAFE_READ_COMMAND_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix} `));
  }

  public async checkPermission(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    const category = this.classifyTool(toolName);

    // READ operations are safe under allow_safe_auto and ask_once_per_session
    if (category === 'read') {
      if (this.mode === 'allow_safe_auto' || this.mode === 'ask_once_per_session') {
        return true;
      }
    }

    // Command execution security check
    if (toolName === 'run_command' && typeof args.command === 'string') {
      this.validateCommandSafety(args.command);
      if (this.mode === 'allow_safe_auto' && this.isSafeCommand(args.command)) {
        return true;
      }
    }

    const sessionKey = `${toolName}:${args.path || args.command || ''}`;
    if (this.mode === 'ask_once_per_session' && this.sessionApprovedTools.has(sessionKey)) {
      return true;
    }

    if (!this.approvalHandler) {
      // Default: allow safe auto if no interactive handler registered, but reject dangerous
      if (this.mode === 'allow_safe_auto' && category !== 'execute') {
        return true;
      }
      return false;
    }

    const request: PermissionRequest = {
      id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolName,
      category,
      description: `Permission requested to execute ${toolName}`,
      command: typeof args.command === 'string' ? args.command : undefined,
      path: typeof args.path === 'string' ? args.path : undefined,
      args
    };

    const approved = await this.approvalHandler(request);
    if (approved && this.mode === 'ask_once_per_session') {
      this.sessionApprovedTools.add(sessionKey);
    }
    return approved;
  }
}
