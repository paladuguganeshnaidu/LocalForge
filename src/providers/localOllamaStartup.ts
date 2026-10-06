import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface OllamaStartupResult {
  status: 'running' | 'started' | 'disabled' | 'skipped' | 'unavailable';
  message: string;
}

interface StartupDependencies {
  platform: string;
  home: string;
  environment: NodeJS.ProcessEnv;
  fileExists: (path: string) => Promise<boolean>;
  directoryExists: (path: string) => Promise<boolean>;
  ready: (endpoint: string) => Promise<boolean>;
  launch: (binary: string, environment: NodeJS.ProcessEnv) => () => string | undefined;
  delay: () => Promise<void>;
  attempts: number;
}

const defaults: StartupDependencies = {
  platform: process.platform,
  home: homedir(),
  environment: process.env,
  fileExists: async path => { try { return (await stat(path)).isFile(); } catch { return false; } },
  directoryExists: async path => { try { return (await stat(path)).isDirectory(); } catch { return false; } },
  ready: async endpoint => {
    try {
      const response = await fetch(`${endpoint}/api/version`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      const body = response.ok ? await response.json() as { version?: unknown } : undefined;
      return typeof body?.version === 'string';
    } catch { return false; }
  },
  launch: (binary, environment) => {
    const child = spawn(binary, ['serve'], { env: environment, detached: true, windowsHide: true, stdio: 'ignore' });
    let failure: string | undefined;
    child.on('error', error => { failure = error.message; });
    child.on('exit', code => { failure = `Ollama exited before becoming ready (${code ?? 'signal'}).`; });
    child.unref();
    return () => failure;
  },
  delay: () => new Promise(resolve => setTimeout(resolve, 1000)),
  attempts: 20
};

export class LocalOllamaStartup {
  private readonly pending = new Map<string, Promise<OllamaStartupResult>>();
  private readonly dependencies: StartupDependencies;

  constructor(dependencies: Partial<StartupDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  ensure(endpoint: string, enabled: boolean): Promise<OllamaStartupResult> {
    if (!enabled) return Promise.resolve({ status: 'disabled', message: 'Automatic Ollama startup is disabled.' });
    let url: URL;
    try { url = new URL(endpoint); } catch { return Promise.resolve({ status: 'skipped', message: 'Invalid Ollama endpoint; no process started.' }); }
    const port = Number(url.port);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || port < 1024 || port > 65535 || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      return Promise.resolve({ status: 'skipped', message: 'Automatic startup only supports unprivileged loopback HTTP Ollama endpoints.' });
    }
    const canonical = url.origin;
    const existing = this.pending.get(canonical);
    if (existing) return existing;
    const work = this.start(url).catch(error => ({ status: 'unavailable' as const, message: `Could not start Ollama: ${error instanceof Error ? error.message : String(error)}` })).finally(() => this.pending.delete(canonical));
    this.pending.set(canonical, work);
    return work;
  }

  private async start(url: URL): Promise<OllamaStartupResult> {
    const dependencies = this.dependencies;
    if (await dependencies.ready(url.origin)) return { status: 'running', message: 'Ollama is already running.' };
    const candidates = dependencies.platform === 'win32'
      ? [join(dependencies.home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'), ...(dependencies.environment.ProgramFiles ? [join(dependencies.environment.ProgramFiles, 'Ollama', 'ollama.exe')] : [])]
      : ['/usr/local/bin/ollama', '/usr/bin/ollama', ...(dependencies.platform === 'darwin' ? ['/Applications/Ollama.app/Contents/Resources/ollama'] : [])];
    let binary: string | undefined;
    for (const candidate of candidates) if (await dependencies.fileExists(candidate)) { binary = candidate; break; }
    if (!binary) return { status: 'unavailable', message: 'Ollama is not installed in a supported location. Install Ollama, then refresh models; no software was downloaded.' };
    const environment: NodeJS.ProcessEnv = { ...dependencies.environment, OLLAMA_HOST: url.host };
    const defaultModels = join(dependencies.home, '.ollama', 'models');
    let fallback = false;
    if (environment.OLLAMA_MODELS && !await dependencies.directoryExists(environment.OLLAMA_MODELS) && await dependencies.directoryExists(defaultModels)) {
      environment.OLLAMA_MODELS = defaultModels;
      fallback = true;
    }
    if (await dependencies.ready(url.origin)) return { status: 'running', message: 'Ollama became available before startup.' };
    const failure = dependencies.launch(binary, environment);
    for (let attempt = 0; attempt < dependencies.attempts; attempt += 1) {
      await dependencies.delay();
      if (await dependencies.ready(url.origin)) return { status: 'started', message: fallback ? 'Ollama started using existing home-directory models because the configured model directory is unavailable. Persistent settings were not changed.' : 'Ollama started; installed models can now be discovered.' };
      if (failure()) return { status: 'unavailable', message: failure()! };
    }
    return { status: 'unavailable', message: 'Ollama startup timed out. It may still be loading; refresh models or inspect Ollama logs. No model download was attempted.' };
  }
}
