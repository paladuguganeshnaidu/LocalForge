import * as fs from 'node:fs';
import * as path from 'node:path';

export type ShellType = 'auto' | 'bash' | 'powershell' | 'cmd';

export interface ResolvedShell {
  type: ShellType;
  executable: string;
  args: string[];
  displayName: string;
  isBash: boolean;
}

/**
 * ShellResolver detects available host shells (Git Bash, WSL, PowerShell, CMD, POSIX sh/bash)
 * and resolves commands to the most appropriate shell environment.
 */
export class ShellResolver {
  private static cachedGitBashPath: string | null | undefined;
  private static cachedWslPath: string | null | undefined;
  private static cachedPowerShellPath: string | null | undefined;

  /**
   * Search for Git Bash executable on Windows in standard locations and PATH.
   */
  public static findGitBash(): string | null {
    if (this.cachedGitBashPath !== undefined) {
      return this.cachedGitBashPath;
    }

    if (process.platform !== 'win32') {
      this.cachedGitBashPath = null;
      return null;
    }

    const candidatePaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
      path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
    ];

    for (const candidate of candidatePaths) {
      if (candidate && fs.existsSync(candidate)) {
        this.cachedGitBashPath = candidate;
        return candidate;
      }
    }

    // Check PATH environment variable for bash.exe
    const envPath = process.env.PATH || '';
    const pathDirs = envPath.split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      const fullPath = path.join(dir, 'bash.exe');
      if (fs.existsSync(fullPath)) {
        // Exclude Windows Subsystem for Linux wrapper in System32 if looking for Git Bash
        this.cachedGitBashPath = fullPath;
        return fullPath;
      }
    }

    this.cachedGitBashPath = null;
    return null;
  }

  /**
   * Search for WSL (Windows Subsystem for Linux) on Windows.
   */
  public static findWsl(): string | null {
    if (this.cachedWslPath !== undefined) {
      return this.cachedWslPath;
    }

    if (process.platform !== 'win32') {
      this.cachedWslPath = null;
      return null;
    }

    const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
    if (fs.existsSync(system32)) {
      this.cachedWslPath = system32;
      return system32;
    }

    this.cachedWslPath = null;
    return null;
  }

  /**
   * Search for PowerShell (pwsh or Windows PowerShell).
   */
  public static findPowerShell(): string | null {
    if (this.cachedPowerShellPath !== undefined) {
      return this.cachedPowerShellPath;
    }

    if (process.platform !== 'win32') {
      // Check for pwsh on Linux / macOS
      const envPath = process.env.PATH || '';
      for (const dir of envPath.split(path.delimiter)) {
        const fullPath = path.join(dir, 'pwsh');
        if (fs.existsSync(fullPath)) {
          this.cachedPowerShellPath = fullPath;
          return fullPath;
        }
      }
      this.cachedPowerShellPath = null;
      return null;
    }

    // Check for pwsh (PowerShell 7+) first in PATH
    const envPath = process.env.PATH || '';
    for (const dir of envPath.split(path.delimiter)) {
      const fullPath = path.join(dir, 'pwsh.exe');
      if (fs.existsSync(fullPath)) {
        this.cachedPowerShellPath = fullPath;
        return fullPath;
      }
    }

    // Fall back to built-in Windows PowerShell
    const winPs = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(winPs)) {
      this.cachedPowerShellPath = winPs;
      return winPs;
    }

    this.cachedPowerShellPath = null;
    return null;
  }

  /**
   * Detect whether a command contains Bash / POSIX specific syntax that fails on CMD.
   */
  public static isBashCommand(command: string): boolean {
    const trimmed = command.trim();

    // 1. Shebang or explicit interpreter
    if (/^#!\s*\/(?:usr\/)?(?:bin\/)?(?:env\s+)?(?:bash|sh)\b/.test(trimmed)) {
      return true;
    }
    if (/^(?:bash|sh)\s+-c\b/.test(trimmed)) {
      return true;
    }

    // 2. POSIX shell keywords at start of line or after semicolon/pipe
    if (/(?:^|[;&|]\s*)(?:export|source|unset|alias|type|which)\s+\S+/i.test(trimmed)) {
      return true;
    }

    // 3. Inline variable assignment before command: FOO=bar my_cmd
    if (/^[A-Za-z_][A-Za-z0-9_]*=[^\s;&|]+\s+[a-zA-Z]/.test(trimmed)) {
      return true;
    }

    // 4. POSIX syntax constructs: $(...), ${...}, heredocs, conditionals
    if (/\$\([a-zA-Z0-9_\s.|-]+\)/.test(trimmed)) {
      return true;
    }
    if (/\$\{[A-Za-z_][A-Za-z0-9_]*[:-][^}]+\}/.test(trimmed)) {
      return true;
    }
    if (/<<-?\s*['"]?[A-Za-z0-9_]+['"]?/.test(trimmed)) {
      return true;
    }
    if (/\bif\s+\[{1,2}\s+.*\s+\]{1,2}\s*;?\s*then\b/.test(trimmed)) {
      return true;
    }
    if (/\b(?:then|fi|done|esac)\b/.test(trimmed) && /;\s*(?:fi|done|esac)\b/.test(trimmed)) {
      return true;
    }

    // 5. Common POSIX-specific flags or utilities that do not exist or fail in CMD
    if (/(?:^|[;&|]\s*)(?:chmod|chown|uname)\s+/.test(trimmed)) {
      return true;
    }
    if (/(?:^|[;&|]\s*)grep\s+-[a-zA-Z]/.test(trimmed)) {
      return true;
    }
    if (/(?:^|[;&|]\s*)cat\s+<</.test(trimmed)) {
      return true;
    }
    if (/(?:^|[;&|]\s*)find\s+\.\s+-name\s+/.test(trimmed)) {
      return true;
    }
    if (/(?:^|[;&|]\s*)mkdir\s+-p\s+/.test(trimmed)) {
      return true;
    }

    return false;
  }

  /**
   * Resolve execution binary, arguments, and shell type for a command.
   */
  public static resolve(requestedShell?: ShellType | string, command?: string): ResolvedShell {
    const isWindows = process.platform === 'win32';
    const req = (requestedShell || 'auto').toLowerCase();

    // 1. Explicit Bash Request
    if (req === 'bash') {
      if (isWindows) {
        const gitBash = this.findGitBash();
        if (gitBash) {
          return {
            type: 'bash',
            executable: gitBash,
            args: ['-c', command || ''],
            displayName: 'Git Bash',
            isBash: true
          };
        }

        const wsl = this.findWsl();
        if (wsl) {
          return {
            type: 'bash',
            executable: wsl,
            args: ['-e', 'bash', '-c', command || ''],
            displayName: 'WSL Bash',
            isBash: true
          };
        }

        // If no bash binary installed on Windows, fallback to PowerShell
        const ps = this.findPowerShell();
        if (ps) {
          return {
            type: 'powershell',
            executable: ps,
            args: ['-NoProfile', '-NonInteractive', '-Command', command || ''],
            displayName: 'PowerShell (Bash fallback)',
            isBash: false
          };
        }

        return {
          type: 'cmd',
          executable: process.env.ComSpec || 'cmd.exe',
          args: ['/d', '/s', '/c', command || ''],
          displayName: 'CMD (Bash unavailable)',
          isBash: false
        };
      }

      // POSIX platform
      const posixShell = process.env.SHELL && fs.existsSync(process.env.SHELL)
        ? process.env.SHELL
        : fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';

      return {
        type: 'bash',
        executable: posixShell,
        args: ['-c', command || ''],
        displayName: path.basename(posixShell),
        isBash: true
      };
    }

    // 2. Explicit PowerShell Request
    if (req === 'powershell') {
      const ps = this.findPowerShell();
      if (ps) {
        return {
          type: 'powershell',
          executable: ps,
          args: ['-NoProfile', '-NonInteractive', '-Command', command || ''],
          displayName: path.basename(ps, '.exe'),
          isBash: false
        };
      }

      return {
        type: isWindows ? 'cmd' : 'bash',
        executable: isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh',
        args: isWindows ? ['/d', '/s', '/c', command || ''] : ['-c', command || ''],
        displayName: isWindows ? 'CMD' : 'sh',
        isBash: !isWindows
      };
    }

    // 3. Explicit CMD Request (Windows only)
    if (req === 'cmd') {
      if (isWindows) {
        return {
          type: 'cmd',
          executable: process.env.ComSpec || 'cmd.exe',
          args: ['/d', '/s', '/c', command || ''],
          displayName: 'CMD',
          isBash: false
        };
      }
      return {
        type: 'bash',
        executable: '/bin/sh',
        args: ['-c', command || ''],
        displayName: 'sh',
        isBash: true
      };
    }

    // 4. Auto Mode
    if (command && this.isBashCommand(command)) {
      if (isWindows) {
        const gitBash = this.findGitBash();
        if (gitBash) {
          return {
            type: 'bash',
            executable: gitBash,
            args: ['-c', command],
            displayName: 'Git Bash (auto)',
            isBash: true
          };
        }
        const wsl = this.findWsl();
        if (wsl) {
          return {
            type: 'bash',
            executable: wsl,
            args: ['-e', 'bash', '-c', command],
            displayName: 'WSL Bash (auto)',
            isBash: true
          };
        }
      } else {
        const posixShell = fs.existsSync('/bin/bash') ? '/bin/bash' : (process.env.SHELL || '/bin/sh');
        return {
          type: 'bash',
          executable: posixShell,
          args: ['-c', command],
          displayName: path.basename(posixShell) + ' (auto)',
          isBash: true
        };
      }
    }

    // Default platform shell
    if (isWindows) {
      return {
        type: 'cmd',
        executable: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', command || ''],
        displayName: 'CMD',
        isBash: false
      };
    }

    const defaultShell = process.env.SHELL || '/bin/sh';
    return {
      type: 'bash',
      executable: defaultShell,
      args: ['-c', command || ''],
      displayName: path.basename(defaultShell),
      isBash: true
    };
  }
}
