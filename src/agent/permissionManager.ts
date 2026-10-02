import { withCancellation } from '../core/cancellation';

export type ToolCategory = 'read' | 'edit' | 'execute';
export type PermissionMode =
  | 'request_review'
  | 'allow_safe_auto'
  | 'always_proceed'
  | 'ask_once_per_session'
  | 'always_ask';

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'request_review' || value === 'allow_safe_auto' || value === 'always_proceed' ||
    value === 'ask_once_per_session' || value === 'always_ask';
}

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
  signal?: AbortSignal;
}

export type ApprovalHandler = (request: PermissionRequest) => Promise<boolean>;

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-rf\s+[\/\\]/i,
  // rm with any flag order/spacing aimed at the filesystem root or the home directory
  /\brm\s+(?:-[a-z-]+\s+)+(?:~|\$home|\$\{home\}|\/)/i,
  /\bdel\s+.*[a-z]:\\/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd[a-z]/i,
  /\bshutdown\b/i,
  /\breboot\b/i
];

// Commands that are not catastrophic (so they can still run) but must never be
// auto-approved, not even in "always proceed" mode: the user has to confirm each one.
const HIGH_RISK_COMMAND_PATTERNS = [
  /\brm\s+\S/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+.*--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+checkout\s+(?:--\s+)?\.(?:\s|$)/i,
  /\bgit\s+branch\s+.*-[dD]\b/i,
  /\bgit\s+(?:rebase|filter-branch|update-ref|gc\s+--prune)/i,
  /\bchmod\s+-r\b|\bchown\s+-r\b/i,
  /\b(?:curl|wget)\b.*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i,
  /\bsudo\b/i,
  /\bnpm\s+(?:publish|unpublish|login|adduser|token)\b/i,
  /\b(?:id_rsa|id_ed25519)\b|\.ssh[\/\\]|\.aws[\/\\]credentials|\/etc\/(?:passwd|shadow)|\.npmrc|\.env\b/i
];

// Flags that turn an otherwise read-only git/node/npm command into code execution or a file write.
const UNSAFE_AUTO_FLAGS: Array<{ command: RegExp; flag: RegExp }> = [
  { command: /^git\b/, flag: /(?:^|\s)(?:-c|-C|--output(?:=|\s|$)|--ext-diff|--textconv|--exec-path|--upload-pack|--receive-pack|--config-env|--git-dir|--work-tree|--no-index)/ },
  { command: /^node\b/, flag: /(?:^|\s)(?:-e|--eval|-p|--print|-r|--require|--import|--input-type|--loader|--experimental-loader|-)(?:=|\s|$)/ },
  { command: /^npm\b/, flag: /(?:^|\s)(?:--prefix|--userconfig|--globalconfig|--script-shell|--registry|--ignore-scripts=false)(?:=|\s|$)/ }
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
    const normalized = command.trim().toLowerCase();
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(normalized)) {
        throw new Error('Command contains potentially catastrophic system operations and was blocked by policy.');
      }
    }
  }

  public isHighRiskCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    return HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  public isSafeCommand(command: string): boolean {
    const normalized = command.trim().toLowerCase();
    try {
      this.validateCommandSafety(command);
    } catch {
      return false;
    }

    // Prohibit shell chaining or redirection in auto-safe execution
    if (hasShellChainingOrRedirection(command)) {
      return false;
    }

    // Newlines separate commands in most shells but are not in SHELL_OPERATORS
    if (/[\r\n]/.test(command)) {
      return false;
    }

    // Reject flags that execute code or write files (git --output, node -e, npm --prefix ...)
    for (const rule of UNSAFE_AUTO_FLAGS) {
      if (rule.command.test(normalized) && rule.flag.test(normalized)) {
        return false;
      }
    }

    // `git branch` may create/delete/rename branches; only allow the listing forms
    if (/^git\s+branch\b/.test(normalized)) {
      const args = normalized.replace(/^git\s+branch\s*/, '').split(/\s+/).filter(Boolean);
      const listingOnly = args.every((a) => ['-a', '-r', '-v', '-vv', '--list', '--show-current', '--all', '--remotes'].includes(a));
      if (!listingOnly) {
        return false;
      }
    }

    return SAFE_TEST_BUILD_COMMAND_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `)
    );
  }

  public shouldAutoApplyEdits(): boolean {
    return this.mode === 'always_proceed';
  }

  public async checkPermission(
    toolName: string,
    args: Record<string, unknown>,
    trustedBuiltinReadOnly = false,
    signal?: AbortSignal,
    requireExplicitApproval = false
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const category = trustedBuiltinReadOnly ? 'read' : this.classifyTool(toolName);

    // 0. Always proceed mode: auto allow after validating safety
    if (this.mode === 'always_proceed' && !requireExplicitApproval) {
      if (toolName === 'run_command' && typeof args.command === 'string') {
        this.validateCommandSafety(args.command);
        // Commands outside the reviewed safe allow-list require explicit approval.
        if (this.isSafeCommand(args.command)) {
          return true;
        }
      } else {
        return true;
      }
    }

    // 1. Read operations: auto allowed in request_review, allow_safe_auto, and ask_once_per_session
    if (category === 'read' && !requireExplicitApproval) {
      return true;
    }

    // 2. Command execution
    if (toolName === 'run_command' && typeof args.command === 'string') {
      this.validateCommandSafety(args.command);
      // Auto-approved only if explicitly safe without chaining
      if (!requireExplicitApproval && (this.mode === 'allow_safe_auto' || this.mode === 'request_review') && this.isSafeCommand(args.command)) {
        return true;
      }
    }

    // 3. Edit operations: allowed to generate proposals for user diff review in request_review and allow_safe_auto
    if (!requireExplicitApproval && category === 'edit' && (this.mode === 'request_review' || this.mode === 'allow_safe_auto')) {
      return true;
    }

    const sessionKey = `${toolName}:${requireExplicitApproval ? JSON.stringify(args) : args.path || args.command || ''}`;
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
        args,
        signal
      };

      const approved = await withCancellation(this.approvalHandler(request), signal);
      signal?.throwIfAborted();
      if (approved && this.mode === 'ask_once_per_session') {
        this.sessionApprovedTools.add(sessionKey);
      }
      return approved;
    }

    // Fallback: If no interactive approval handler registered
    return false;
  }
}
