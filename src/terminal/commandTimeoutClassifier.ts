export type CommandCategory = 'install' | 'build_test' | 'standard' | 'explicit';

export interface CommandTimeoutPolicy {
  maxTimeoutMs: number;
  inactivityTimeoutMs: number;
  category: CommandCategory;
  reason: string;
}

/**
 * CommandTimeoutClassifier provides intelligent, category-aware timeouts
 * and streaming inactivity windows for commands.
 */
export class CommandTimeoutClassifier {
  private static readonly INSTALL_PATTERNS = [
    // Node / JS package managers
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update|upgrade|ci)\b/i,
    /\bnpx\s+(?:create-|@)/i,
    // Python package managers
    /\b(?:pip|pip3|pipenv|poetry|conda|mamba)\s+(?:install|add|update)\b/i,
    // Rust / Cargo
    /\bcargo\s+(?:install|add|build|fetch)\b/i,
    // Go
    /\bgo\s+(?:get|install)\b/i,
    // PHP / Composer
    /\bcomposer\s+(?:install|require|update)\b/i,
    // Ruby / Gem
    /\b(?:gem\s+install|bundle\s+install|bundle\s+add)\b/i,
    // .NET / Nuget
    /\bdotnet\s+(?:restore|add|tool\s+install)\b/i,
    // System package managers
    /\b(?:apt|apt-get|brew|pacman|dnf|yum|apk|choco|winget)\s+(?:install|-S)\b/i,
    // Docker / Git large operations
    /\bdocker\s+(?:pull|build|compose\s+up)\b/i,
    /\bgit\s+(?:clone|submodule\s+update)\b/i
  ];

  private static readonly BUILD_TEST_PATTERNS = [
    /\bnpm\s+run\s+(?:build|compile|test|typecheck|lint)\b/i,
    /\b(?:pnpm|yarn|bun)\s+(?:build|compile|test|typecheck)\b/i,
    /\b(?:tsc|webpack|vite|rollup|esbuild|next\s+build|nuxt\s+build)\b/i,
    /\b(?:pytest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)\b/i,
    /\b(?:make|cmake|ninja)\b/i
  ];

  /**
   * Determine if a command is a package installation or environment setup command.
   */
  public static isInstallCommand(command: string): boolean {
    const trimmed = command.trim();
    return this.INSTALL_PATTERNS.some(p => p.test(trimmed));
  }

  /**
   * Determine if a command is a compilation, build, or test execution command.
   */
  public static isBuildOrTestCommand(command: string): boolean {
    const trimmed = command.trim();
    return this.BUILD_TEST_PATTERNS.some(p => p.test(trimmed));
  }

  /**
   * Classify command and calculate adaptive timeout ceilings and inactivity watchdog windows.
   */
  public static classify(command: string, requestedTimeoutMs?: number): CommandTimeoutPolicy {
    // 1. Explicit short timeout requested by caller (e.g. unit tests with timeoutMs = 200, 5000, 15000)
    if (typeof requestedTimeoutMs === 'number' && requestedTimeoutMs > 0 && requestedTimeoutMs < 60000) {
      return {
        maxTimeoutMs: requestedTimeoutMs,
        inactivityTimeoutMs: requestedTimeoutMs,
        category: 'explicit',
        reason: `Explicit short timeout requested by caller (${requestedTimeoutMs}ms)`
      };
    }

    // 2. Explicit long timeout (> 60000) requested by caller (e.g. projectTools requesting 300000)
    if (typeof requestedTimeoutMs === 'number' && requestedTimeoutMs > 60000) {
      return {
        maxTimeoutMs: requestedTimeoutMs,
        inactivityTimeoutMs: Math.min(120000, requestedTimeoutMs),
        category: 'explicit',
        reason: `Explicit custom timeout requested by caller (${requestedTimeoutMs}ms)`
      };
    }

    // 3. Package installation command: promote ceiling to 10 minutes, with 2-minute inactivity heartbeat
    if (this.isInstallCommand(command)) {
      return {
        maxTimeoutMs: 600_000, // 10 minutes
        inactivityTimeoutMs: 120_000, // 2 minutes of complete silence
        category: 'install',
        reason: 'Adaptive timeout for package installation / download operation'
      };
    }

    // 4. Build or test command: promote ceiling to 5 minutes, with 90-second inactivity heartbeat
    if (this.isBuildOrTestCommand(command)) {
      return {
        maxTimeoutMs: 300_000, // 5 minutes
        inactivityTimeoutMs: 90_000, // 90 seconds of complete silence
        category: 'build_test',
        reason: 'Adaptive timeout for build / compilation / test operation'
      };
    }

    // 5. Standard utility command
    return {
      maxTimeoutMs: 120_000, // 2 minutes ceiling
      inactivityTimeoutMs: 60_000, // 60 seconds inactivity window
      category: 'standard',
      reason: 'Standard command execution timeout'
    };
  }
}
