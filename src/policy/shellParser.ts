export type ShellFamily = 'powershell' | 'cmd' | 'posix';

export interface ParsedCommandSegment {
  program: string;
  args: string[];
  raw: string;
  operatorBefore?: string;
  hasRedirection: boolean;
  hasSubshell: boolean;
}

export interface ShellParseResult {
  shellFamily: ShellFamily;
  originalCommand: string;
  segments: ParsedCommandSegment[];
  isChained: boolean;
  hasDestructiveSegment: boolean;
  destructiveReasons: string[];
}

const DESTRUCTIVE_PROGRAMS = new Set([
  'mkfs',
  'format',
  'dd',
  'shutdown',
  'reboot',
  'init'
]);

const CRITICAL_POWERSHELL_PATTERNS = [
  /\bInvoke-Expression\b/i,
  /\bIEX\b/i,
  /\bDownloadString\b/i,
  /\bDownloadFile\b/i,
  /\bSet-ExecutionPolicy\s+Bypass\b/i,
  /\bStop-Computer\b/i,
  /\bRestart-Computer\b/i,
  /\bClear-Disk\b/i,
  /\bFormat-Volume\b/i,
  /\bRemove-Item\s+.*-(?:Recurse|r)\s+.*(?:[a-z]:\\|\/)/i
];

export class ShellParser {
  public static detectShellFamily(command: string): ShellFamily {
    if (/^#!\s*\/(?:usr\/)?(?:bin\/)?(?:env\s+)?(?:bash|sh)\b/i.test(command) ||
        /(?:^|[;&|]\s*)(?:export|source|unset|alias|which)\s+[A-Za-z_]/i.test(command) ||
        /\b(?:bash|sh)\s+-c\b/i.test(command)) {
      return 'posix';
    }
    if (process.platform === 'win32') {
      if (/^\s*(?:dir|copy|move|ren|del|type|cls|md|rd)\b/i.test(command) || /%[a-zA-Z0-9_]+%/.test(command)) {
        return 'cmd';
      }
      if (/\$(?:env:)?[a-zA-Z0-9_]+/i.test(command) || /-(?:eq|ne|match|like)\b/i.test(command) || /\b(?:Get-|Set-|Remove-|Start-|Stop-|New-)[a-zA-Z]+/i.test(command)) {
        return 'powershell';
      }
      return 'powershell'; // Default on Windows PowerShell
    }
    return 'posix';
  }

  public static parse(command: string, explicitFamily?: ShellFamily): ShellParseResult {
    const raw = command.trim();
    const shellFamily = explicitFamily ?? this.detectShellFamily(raw);
    const destructiveReasons: string[] = [];

    // Check catastrophic regex patterns across full command line
    if (/\brm\s+(?:-[a-z]*r[a-z]*\s+)?[\/\\](?:\s|$)/i.test(raw) || /\brm\s+-rf\s+[\/\\]/i.test(raw)) {
      destructiveReasons.push('Catastrophic root filesystem deletion attempted.');
    }
    if (/\bdel\s+.*[a-z]:\\/i.test(raw) || /\brmdir\s+\/s\s+\/q\s+[a-z]:\\/i.test(raw)) {
      destructiveReasons.push('Catastrophic Windows drive deletion attempted.');
    }
    if (/:(){ :|:& };:/.test(raw)) {
      destructiveReasons.push('Fork-bomb attack pattern detected.');
    }
    if (/>\s*\/dev\/sd[a-z]/i.test(raw)) {
      destructiveReasons.push('Direct disk device overwrite attempted.');
    }

    if (shellFamily === 'powershell') {
      for (const pattern of CRITICAL_POWERSHELL_PATTERNS) {
        if (pattern.test(raw)) {
          destructiveReasons.push(`High-risk PowerShell capability detected: ${pattern.source}`);
        }
      }
    }

    // Split on shell chaining operators: &&, ||, ;, |, &
    const operatorRegex = /(\&\&|\|\||;|\||&)/g;
    const tokens = raw.split(operatorRegex);
    const segments: ParsedCommandSegment[] = [];

    let currentOp: string | undefined = undefined;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].trim();
      if (!token) continue;

      if (token === '&&' || token === '||' || token === ';' || token === '|' || token === '&') {
        currentOp = token;
        continue;
      }

      // Check subshell or redirection
      const hasRedirection = /[<>]/g.test(token);
      const hasSubshell = /\$\(|\`/.test(token);

      // Tokenize individual command args respecting quotes
      const args = this.tokenize(token);
      const program = args.length > 0 ? args[0].toLowerCase() : '';

      if (DESTRUCTIVE_PROGRAMS.has(program)) {
        destructiveReasons.push(`Destructive program invocation: "${program}"`);
      }

      segments.push({
        program,
        args: args.slice(1),
        raw: token,
        operatorBefore: currentOp,
        hasRedirection,
        hasSubshell
      });

      currentOp = undefined;
    }

    return {
      shellFamily,
      originalCommand: raw,
      segments,
      isChained: segments.length > 1,
      hasDestructiveSegment: destructiveReasons.length > 0,
      destructiveReasons
    };
  }

  private static tokenize(commandSegment: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < commandSegment.length; i++) {
      const ch = commandSegment[i];

      if (ch === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (ch === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (/\s/.test(ch) && !inSingleQuote && !inDoubleQuote) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }
}
