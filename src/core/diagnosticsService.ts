import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { ModelRegistry } from '../providers/modelRegistry';
import { RemoteManager } from '../remote/remoteManager';
import { WorkspaceIndexer } from '../context/workspaceIndexer';
import { ToolRegistry } from '../agent/toolRegistry';
import { PermissionManager } from '../agent/permissionManager';

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
    private readonly indexer?: WorkspaceIndexer,
    private readonly toolRegistry?: ToolRegistry,
    private readonly permissionManager?: PermissionManager
  ) {}

  public async runDiagnostics(): Promise<DiagnosticsReport> {
    const items: DiagnosticItem[] = [];

    // 1. Environment & Platform
    items.push({
      name: 'Host Environment',
      status: 'green',
      details: `VS Code: ${vscode.version}, Node.js: ${process.version}, Platform: ${process.platform} (${process.arch})`
    });

    // 2. Workspace Trust & State
    if (vscode.workspace.isTrusted) {
      const folders = vscode.workspace.workspaceFolders || [];
      items.push({
        name: 'Workspace State',
        status: 'green',
        details: `Workspace is trusted with ${folders.length} folder(s) loaded.`
      });
    } else {
      items.push({
        name: 'Workspace State',
        status: 'red',
        details: 'Workspace is untrusted. File reads, edits, and terminal tools are disabled.',
        remediation: 'Click the Manage Workspace Trust button in the VS Code status bar and trust this workspace.'
      });
    }

    // 3. Git Installation & Repository Status
    const gitItem = await new Promise<DiagnosticItem>((resolve) => {
      exec('git --version', { timeout: 10000 }, (err, stdout) => {
        if (err) {
          resolve({
            name: 'Git Integration',
            status: 'yellow',
            details: 'Git CLI is not found in PATH.',
            remediation: 'Install Git and ensure it is available in your system PATH.'
          });
        } else {
          resolve({
            name: 'Git Integration',
            status: 'green',
            details: `Git is available: ${stdout.trim()}`
          });
        }
      });
    });
    items.push(gitItem);

    // 4. Local Ollama & Provider Runtime
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

    // 5. Model Discovery & Capabilities
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

    // 6. GPU & Acceleration Status
    const gpuItem = await new Promise<DiagnosticItem>((resolve) => {
      exec('nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader', { timeout: 10000 }, (err, stdout) => {
        if (!err && stdout.trim()) {
          resolve({
            name: 'Local GPU Acceleration',
            status: 'green',
            details: `Detected local NVIDIA GPU: ${stdout.trim().split('\n')[0]}`
          });
        } else {
          resolve({
            name: 'Local GPU Acceleration',
            status: 'green',
            details: 'No local NVIDIA discrete GPU detected or nvidia-smi unavailable. Running in CPU/APU or remote mode.'
          });
        }
      });
    });
    items.push(gpuItem);

    // 7. Remote GPU Connections
    const activeRemote = this.remoteManager.getActiveSession();
    if (activeRemote) {
      const gpu = activeRemote.gpuStatus?.[0];
      const gpuText = gpu ? gpu.displayText : 'GPU detected via SSH';
      items.push({
        name: 'Remote GPU Connection',
        status: 'green',
        details: `Connected to ${activeRemote.profile.name} (${activeRemote.profile.host}). ${gpuText}`
      });
    } else {
      const profiles = this.remoteManager.getProfiles();
      items.push({
        name: 'Remote GPU Connection',
        status: 'green',
        details: profiles.length > 0 ? `${profiles.length} remote GPU profile(s) configured, currently idle.` : 'No remote GPU hosts configured (optional).'
      });
    }

    // 8. Tool Registry Inventory
    if (this.toolRegistry) {
      const toolCount = this.toolRegistry.getAllTools().length;
      items.push({
        name: 'Tool Registry',
        status: 'green',
        details: `${toolCount} core tools registered across read, edit, execute, and browser categories.`
      });
    }

    // 9. Context Indexing
    if (this.indexer) {
      const stats = this.indexer.getStats();
      items.push({
        name: 'Workspace Context Indexer',
        status: stats.error ? 'red' : stats.limitReached || !stats.watching || stats.state !== 'ready' ? 'yellow' : 'green',
        details: `${stats.state}: ${stats.fileCount} files / ${stats.chunkCount} chunks (${Math.round(stats.totalChars / 1024)} KB text). Watching: ${stats.watching}. ${stats.limitReached ? 'Index limit reached; coverage is partial. ' : ''}${stats.error ?? ''}`
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
    const statusText = report.overallStatus === 'green' ? '[HEALTHY]' : report.overallStatus === 'yellow' ? '[WARNINGS DETECTED]' : '[ACTION REQUIRED]';
    const lines = [
      `# LocalForge Doctor Report`,
      `**Overall Health**: ${statusText}`,
      `*Checked at: ${new Date(report.timestamp).toLocaleString()}*`,
      '',
      '---',
      '',
      '## Subsystem Diagnostics',
      ''
    ];

    for (const item of report.items) {
      const itemBadge = item.status === 'green' ? '[PASS]' : item.status === 'yellow' ? '[WARN]' : '[FAIL]';
      lines.push(`### ${itemBadge} ${item.name}`);
      lines.push(`${item.details}`);
      if (item.remediation) {
        lines.push(`> **Fix**: ${item.remediation}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}
