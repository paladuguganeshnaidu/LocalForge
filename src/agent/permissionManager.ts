import { classifyCommand, CommandRisk } from '../security/commandPolicy';
export type ToolCategory = 'read' | 'edit' | 'execute';
export type PermissionMode =
  | 'request_review'
  | 'allow_safe_auto'
  | 'always_proceed'
  | 'ask_once_per_session'
  | 'always_ask';

export type CommandCategory =
  | 'read-only'
  | 'test'
  | 'build'
  | 'lint'
  | 'package'
  | 'version control'
  | 'file mutation'
  | 'network'
  | 'process control'
  | 'destructive';

export interface PermissionRequest {
  id: string;
  toolName: string;
  category: ToolCategory;
  description: string;
  command?: string;
  commandCategory?: CommandCategory;
  path?: string;
  args?: Record<string, unknown>;
}

export type ApprovalHandler = (request: PermissionRequest) => Promise<boolean>;

const DESTRUCTIVE_COMMAND_PATTERNS = [
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

const SHELL_OPERATORS = [
  /&&/,
  /\|\|/,
  /;/,
  /\|/,
  /</,
  />/,
  />>/,
  /2>/,
  /&/,
  /`/,
  /\$\(/
];

const SAFE_TEST_BUILD_COMMAND_PREFIXES = [
  'npm test',
  'npm run test',
  'npm start',
  'npm run start',
  'npm run lint',
  'npm run build',
  'node',
  'cargo check',
  'cargo test',
  'pytest',
  'go test',
  'python -m unittest',
  'mvn test',
  './gradlew test',
  'git status',
  'git diff',
  'git log',
  'git branch'
];

export function hasShellChainingOrRedirection(cmd: string): boolean {
  return SHELL_OPERATORS.some((pattern) => pattern.test(cmd));
}

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
    if (
      toolName.startsWith('read_') ||
      toolName.startsWith('search_') ||
      toolName.startsWith('list_') ||
      toolName === 'git_status' ||
      toolName === 'git_diff' ||
      toolName === 'detect_project'
    ) {
      return 'read';
    }
    if (
      toolName.startsWith('write_') ||
      toolName.startsWith('edit_') ||
      toolName.startsWith('delete_') ||
      toolName.startsWith('apply_patch')
    ) {
      return 'edit';
    }
    return 'execute';
  }

  public categorizeCommand(command: string): CommandCategory {
    const norm = command.trim().toLowerCase();
    for (const pat of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pat.test(norm)) return 'destructive';
    }
    if (norm.startsWith('git ') || norm === 'git') {
      return 'version control';
    }
    if (norm.startsWith('npm test') || norm.startsWith('cargo test') || norm.startsWith('pytest') || norm.startsWith('go test')) {
      return 'test';
    }
    if (norm.startsWith('npm run build') || norm.startsWith('cargo build') || norm.startsWith('go build')) {
      return 'build';
    }
    if (norm.startsWith('npm run lint') || norm.startsWith('flake8') || norm.startsWith('cargo clippy')) {
      return 'lint';
    }
    if (norm.startsWith('rm ') || norm.startsWith('del ') || norm.startsWith('mkdir ') || norm.startsWith('touch ')) {
      return 'file mutation';
    }
    if (norm.startsWith('curl ') || norm.startsWith('wget ') || norm.startsWith('ssh ')) {
      return 'network';
    }
    if (norm.startsWith('npm i') || norm.startsWith('npm install') || norm.startsWith('pip install') || norm.startsWith('cargo add') || norm.startsWith('yarn add')) {
      return 'package';
    }
    if (norm.startsWith('kill ') || norm.startsWith('pkill ') || norm.startsWith('taskkill ')) {
      return 'process control';
    }
    return 'read-only';
  }

  public classifyCommand(command: string): CommandCategory {
    return this.categorizeCommand(command);
  }

  public validateCommandSafety(command: string): void {
    const decision = classifyCommand(command);
    if (decision.risk === 'DESTRUCTIVE') {
      throw new Error('Command contains potentially catastrophic system operations and was blocked by policy.');
    }
  }

  public isSafeCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    const decision = classifyCommand(command);
    if (!decision.allowed || decision.requiresApproval) return false;
    if (decision.risk === 'DESTRUCTIVE' as CommandRisk) return false;
    if (hasShellChainingOrRedirection(command)) return false;
    return SAFE_TEST_BUILD_COMMAND_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `)
    );
  }

  public shouldAutoApplyEdits(): boolean {
    return this.mode === 'always_proceed';
  }

  public async checkPermission(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    const category = this.classifyTool(toolName);

    // 0. Always proceed mode: auto allow after validating safety
    if (this.mode === 'always_proceed') {
      if (toolName === 'run_command' && typeof args.command === 'string') {
        this.validateCommandSafety(args.command);
      }
      return true;
    }

    // 1. Read operations: auto allowed in request_review, allow_safe_auto, and ask_once_per_session
    if (category === 'read') {
      return true;
    }

    // 2. Command execution
    if (toolName === 'run_command' && typeof args.command === 'string') {
      this.validateCommandSafety(args.command);
      // Auto-approved only if explicitly safe without chaining
      if ((this.mode === 'allow_safe_auto' || this.mode === 'request_review') && this.isSafeCommand(args.command)) {
        return true;
      }
    }

    // 3. Edit operations: allowed to generate proposals for user diff review in request_review and allow_safe_auto
    if (category === 'edit' && (this.mode === 'request_review' || this.mode === 'allow_safe_auto')) {
      return true;
    }

    const sessionKey = `${toolName}:${args.path || args.command || ''}`;
    if (this.mode === 'ask_once_per_session' && this.sessionApprovedTools.has(sessionKey)) {
      return true;
    }

    // If an approval handler is registered, ask the user
    if (this.approvalHandler) {
      const cmd = typeof args.command === 'string' ? args.command : undefined;
      const request: PermissionRequest = {
        id: `perm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        toolName,
        category,
        description: `Permission requested to execute ${toolName}`,
        command: cmd,
        commandCategory: cmd ? this.categorizeCommand(cmd) : undefined,
        path: typeof args.path === 'string' ? args.path : undefined,
        args
      };

      const approved = await this.approvalHandler(request);
      if (approved && this.mode === 'ask_once_per_session') {
        this.sessionApprovedTools.add(sessionKey);
      }
      return approved;
    }

    // Fallback: If no interactive approval handler registered
    return false;
  }
}
