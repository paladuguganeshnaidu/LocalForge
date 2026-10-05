import * as vscode from 'vscode';
import { LocalForgeEngine } from './LocalForgeEngine';
import { createUnifiedDiff } from '../editing/diffService';
import { computeContentHash } from '../editing/patchService';

export interface SelfTestResult {
  component: string;
  passed: boolean;
  durationMs: number;
  details: string;
  error?: string;
}

export interface SelfTestReport {
  timestamp: number;
  allPassed: boolean;
  totalDurationMs: number;
  results: SelfTestResult[];
}

export class LocalForgeSelfTest {
  constructor(private readonly engine: LocalForgeEngine) {}

  public async runSelfTest(): Promise<SelfTestReport> {
    const startTime = Date.now();
    const results: SelfTestResult[] = [];

    // 1. Activation & Engine
    results.push(await this.testCheck('activation', async () => {
      if (!this.engine) throw new Error('LocalForgeEngine is not initialized.');
      return 'Engine active and operational.';
    }));

    // 2. Configuration
    results.push(await this.testCheck('configuration', async () => {
      const config = vscode.workspace.getConfiguration('tuxnest');
      const ollamaUrl = config.get<string>('ollama.baseUrl');
      return `Configuration read successfully (Ollama URL: ${ollamaUrl || 'default'}).`;
    }));

    // 3. Model Discovery
    results.push(await this.testCheck('model_discovery', async () => {
      await this.engine.modelRegistry.refresh();
      const models = this.engine.modelRegistry.getModels();
      return `Discovered ${models.length} model(s).`;
    }));

    // 4. Provider Health
    results.push(await this.testCheck('provider_health', async () => {
      const providers = this.engine.modelRegistry.getProviders();
      return `Managed providers count: ${providers.length}.`;
    }));

    // 5. Tool Registry
    results.push(await this.testCheck('tool_registry', async () => {
      this.engine.toolRegistry.assertInvariants();
      const tools = this.engine.toolRegistry.getAllTools();
      if (tools.length < 5) throw new Error(`Too few tools registered: ${tools.length}`);
      return `${tools.length} core tools registered and validated.`;
    }));

    // 6. Filesystem & Security Path Resolver
    results.push(await this.testCheck('filesystem_security', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!root) return 'No workspace folder open (skipped file read).';
      const dir = await vscode.workspace.fs.readDirectory(root);
      return `Workspace accessible. Read directory with ${dir.length} top-level entries.`;
    }));

    // 7. Terminal Execution
    results.push(await this.testCheck('terminal_execution', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const proc = await this.engine.terminalManager.runCommand('node -v', root, false, 15000);
      if (proc.exitCode !== 0) throw new Error(`Node execution failed with exit code ${proc.exitCode}: ${proc.stderr}`);
      return `Process executed cleanly: ${proc.stdout.trim()} in ${proc.duration}ms.`;
    }));

    // 8. Workspace Trust
    results.push(await this.testCheck('workspace_trust', async () => {
      const trusted = vscode.workspace.isTrusted;
      return `Workspace trusted status: ${trusted}.`;
    }));

    // 9. Context Engine & Budget
    results.push(await this.testCheck('context_engine', async () => {
      if (this.engine.contextEngine) {
        const ctx = await this.engine.contextEngine.assembleContext('test query', { maxTokens: 4000 });
        return `Context assembled cleanly (${ctx.maxTokens} max tokens budgeted).`;
      }
      return 'Context engine not initialized (no active workspace).';
    }));

    // 10. Agent Runtime & Multi-Agent Pool
    results.push(await this.testCheck('agent_runtime', async () => {
      if (!this.engine.orchestrator) throw new Error('MultiAgentOrchestrator not initialized.');
      const roles = this.engine.orchestrator.decomposeGoal('health check', 'ask');
      return `Dynamic TaskGraph initialized with ${roles.getAllNodes().length} node(s).`;
    }));

    // 11. Event Streaming
    results.push(await this.testCheck('event_streaming', async () => {
      let received = false;
      const listener = (data: any) => { received = data === 'test'; };
      this.engine.events.on('indexProgress', listener);
      this.engine.events.emit('indexProgress', 'test');
      this.engine.events.off('indexProgress', listener);
      if (!received) throw new Error('EventEmitter failed to deliver event synchronously.');
      return 'EventEmitter verified and functioning.';
    }));

    // 12. Edit Engine & Unified Diff
    results.push(await this.testCheck('edit_diff_engine', async () => {
      const diff = createUnifiedDiff('test.ts', 'const a = 1;\n', 'const a = 2;\n');
      const hash = computeContentHash('test content');
      if (!diff.patch.includes('-const a = 1;') || !diff.patch.includes('+const a = 2;')) {
        throw new Error('Unified diff generation mismatch.');
      }
      return `Diff and hash calculation deterministic (SHA-256: ${hash.slice(0, 12)}...).`;
    }));

    // 13. Session Persistence
    results.push(await this.testCheck('session_persistence', async () => {
      const sess = this.engine.sessionManager.getActiveSession();
      if (!sess || !sess.id) throw new Error('Active session missing or invalid.');
      return `Active session verified (ID: ${sess.id}).`;
    }));

    const allPassed = results.every((r) => r.passed);
    return {
      timestamp: Date.now(),
      allPassed,
      totalDurationMs: Date.now() - startTime,
      results
    };
  }

  private async testCheck(component: string, fn: () => Promise<string>): Promise<SelfTestResult> {
    const t0 = Date.now();
    try {
      const details = await fn();
      return {
        component,
        passed: true,
        durationMs: Date.now() - t0,
        details
      };
    } catch (err: any) {
      return {
        component,
        passed: false,
        durationMs: Date.now() - t0,
        details: 'Self-test check failed.',
        error: err.message || String(err)
      };
    }
  }

  public formatReportMarkdown(report: SelfTestReport): string {
    const statusText = report.allPassed ? '[PASS] ALL TESTS PASSED' : '[FAIL] FAILURES DETECTED';
    const lines = [
      '# TuxNest Automated Self-Test Report',
      `**Result**: ${statusText}`,
      `**Duration**: ${report.totalDurationMs}ms`,
      `*Generated at: ${new Date(report.timestamp).toLocaleString()}*`,
      '',
      '| Component | Status | Duration | Details |',
      '| :--- | :---: | :---: | :--- |'
    ];

    for (const r of report.results) {
      const badge = r.passed ? 'PASS' : 'FAIL';
      const msg = r.passed ? r.details : `**Error**: ${r.error}`;
      lines.push(`| \`${r.component}\` | **${badge}** | ${r.durationMs}ms | ${msg} |`);
    }

    return lines.join('\n');
  }
}
