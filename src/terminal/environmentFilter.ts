const DEFAULT_ALLOWED_ENV_VARS = new Set([
  'path',
  'temp',
  'tmp',
  'systemroot',
  'windir',
  'user',
  'username',
  'home',
  'userprofile',
  'homedrive',
  'homepath',
  'lang',
  'lc_all',
  'node_env',
  'comspec',
  'shell',
  'term',
  'appdata',
  'localappdata',
  'programdata',
  'programfiles',
  'programfiles(x86)',
  'pathext',
  'number_of_processors',
  'processor_architecture',
  'processor_identifier',
  'psmodulepath',
  // Toolchain and runtime homes
  'nvm_dir',
  'nvm_bin',
  'nvm_inc',
  'cargo_home',
  'rustup_home',
  'gopath',
  'goroot',
  'pythonhome',
  'pythonpath',
  'pnpm_home',
  'java_home',
  'git_exec_path',
  'npm_config_cache',
  'npm_config_prefix',
  'ci'
]);

const FORBIDDEN_SECRET_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private[_-]?key/i
];

export class EnvironmentFilter {
  public static filterEnvironment(
    rawEnv: NodeJS.ProcessEnv = process.env,
    extraAllowedKeys: string[] = []
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const extraSet = new Set(extraAllowedKeys.map((k) => k.toLowerCase()));

    for (const [key, val] of Object.entries(rawEnv)) {
      if (val === undefined) continue;

      const lowerKey = key.toLowerCase();

      // Check if explicitly allowed
      const isWhitelisted = DEFAULT_ALLOWED_ENV_VARS.has(lowerKey) || extraSet.has(lowerKey);

      // Check if forbidden secret pattern
      const isSecretPattern = FORBIDDEN_SECRET_PATTERNS.some((pat) => pat.test(lowerKey));

      if (isWhitelisted && !isSecretPattern) {
        sanitized[key] = val;
      } else if (extraSet.has(lowerKey)) {
        // Explicit user override
        sanitized[key] = val;
      }
    }

    return sanitized;
  }
}
