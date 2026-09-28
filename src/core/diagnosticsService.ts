import * as vscode from 'vscode';
import { ModelRegistry } from '../providers/modelRegistry';
import { RemoteManager } from '../remote/remoteManager';
import { WorkspaceIndexer } from '../context/workspaceIndexer';

export type DiagnosticStatus = 'green' | 'yellow' | 'red';

export interface DiagnosticItem {
  name: string;
  status: DiagnosticStatus;
  details: string;
  remediation?: string;
}

export interface DiagnosticsReport {
  overallStatus: DiagnosticStatus;
  items: DiagnosticItem[];
  timestamp: number;
}

export class DiagnosticsService {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly remoteManager: RemoteManager,
    private readonly indexer?: WorkspaceIndexer
  ) {}

  public async runDiagnostics(): Promise<DiagnosticsReport> {
    const items: DiagnosticItem[] = [];

    // 1. Workspace Trust
    if (vscode.workspace.isTrusted) {
      items.push({
        name: 'Workspace Trust',
        status: 'green',
        details: 'Workspace is trusted. All file operations and tools are enabled.'
      });
    } else {
      items.push({
        name: 'Workspace Trust',
        status: 'red',
        details: 'Workspace is untrusted. File reads, edits, and terminal tools are disabled.',
        remediation: 'Click the Manage Workspace Trust button in the VS Code status bar and trust this workspace.'
      });
    }

    // 2. Local Ollama Runtime & Endpoints
    await this.registry.refresh();
    const providers = this.registry.getProviders();
    const localOllama = providers.find((p) => p.id === 'ollama');

    if (localOllama?.healthy) {
      items.push({
        name: 'Local Ollama Runtime',
        status: 'green',
        details: `Connected to ${localOllama.endpoint}. Local models ready.`
      });
    } else {
      items.push({
        name: 'Local Ollama Runtime',
        status: 'yellow',
        details: `Ollama is not responding at ${localOllama?.endpoint || 'http://127.0.0.1:11434'}.`,
        remediation: 'Start Ollama locally (`ollama serve`) or check that the endpoint is running on port 11434.'
      });
    }

    // 3. Model Discovery & Capabilities
    const allModels = this.registry.getAllModels();
    if (allModels.length > 0) {
      const toolCallingCount = allModels.filter((m) => m.capabilities?.toolCalling).length;
      items.push({
        name: 'Model Discovery & Capabilities',
        status: toolCallingCount > 0 ? 'green' : 'yellow',
        details: `Discovered ${allModels.length} model(s). ${toolCallingCount} support tool calling for Agent Mode.`,
        remediation: toolCallingCount === 0 ? 'Pull a model with tool calling capabilities like `ollama pull qwen2.5-coder` or `ollama pull llama3.1`.' : undefined
      });
    } else {
      items.push({
        name: 'Model Discovery & Capabilities',
        status: 'red',
        details: 'No local or remote models discovered.',
        remediation: 'Download a model using `ollama pull qwen2.5-coder:7b` or configure an OpenAI-compatible endpoint.'
      });
    }

    // 4. Remote GPU & SSH Tunnel
    const activeRemote = this.remoteManager.getActiveSession();
    if (activeRemote) {
      const gpu = activeRemote.gpuStatus?.[0];
      const gpuText = gpu ? gpu.displayText : 'GPU detected via SSH';
      items.push({
        name: 'Remote GPU System',
        status: 'green',
        details: `Connected to ${activeRemote.profile.name} (${activeRemote.profile.host}). ${gpuText}`
      });
    } else {
      const profiles = this.remoteManager.getProfiles();
      items.push({
        name: 'Remote GPU System',
        status: profiles.length > 0 ? 'yellow' : 'green',
        details: profiles.length > 0 ? `${profiles.length} remote GPU profile(s) configured, currently idle.` : 'No remote GPU hosts configured (optional).',
        remediation: profiles.length > 0 ? 'Use "Connect Remote GPU" in settings if you want to offload heavy inference.' : undefined
      });
    }

    // 5. Context Indexing
    if (this.indexer) {
      const stats = this.indexer.getStats();
      items.push({
        name: 'Workspace Context Indexer',
        status: 'green',
        details: `Indexed ${stats.fileCount} workspace files (${Math.round(stats.totalChars / 1024)} KB code indexed).`
      });
    } else {
      items.push({
        name: 'Workspace Context Indexer',
        status: 'yellow',
        details: 'Context indexer not initialized (no active workspace folder).'
      });
    }

    // Calculate overall status
    let overallStatus: DiagnosticStatus = 'green';
    if (items.some((i) => i.status === 'red')) {
      overallStatus = 'red';
    } else if (items.some((i) => i.status === 'yellow')) {
      overallStatus = 'yellow';
    }

    return {
      overallStatus,
      items,
      timestamp: Date.now()
    };
  }

  public formatReportMarkdown(report: DiagnosticsReport): string {
    const icon = report.overallStatus === 'green' ? '🟢 Healthy' : report.overallStatus === 'yellow' ? '🟡 Warnings Detected' : '🔴 Action Required';
    const lines = [
      `# 🛠️ LocalForge Installation Diagnostics`,
      `**Overall Health**: ${icon}`,
      `*Checked at: ${new Date(report.timestamp).toLocaleTimeString()}*`,
      '',
      '---',
      ''
    ];

    for (const item of report.items) {
      const itemIcon = item.status === 'green' ? '✓' : item.status === 'yellow' ? '⚠️' : '❌';
      lines.push(`### ${itemIcon} ${item.name}`);
      lines.push(`${item.details}`);
      if (item.remediation) {
        lines.push(`> **Fix**: ${item.remediation}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
