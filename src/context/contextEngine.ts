import * as vscode from 'vscode';
import { WorkspaceIndexer } from './workspaceIndexer';
import { LexicalRetrievalEngine, RetrievalEngine, SearchMatch } from './retrieval';
import { ContextBudget } from './contextBudget';

export interface ContextItem {
  source: 'selection' | 'active_file' | 'open_tabs' | 'retrieval' | 'diagnostics' | 'git';
  label: string;
  path?: string;
  content: string;
  tokenEstimate: number;
}

export interface AssembledContext {
  promptText: string;
  items: ContextItem[];
  totalTokens: number;
  maxTokens: number;
  summary: string;
}

export interface ContextEngineOptions {
  maxTokens?: number;
  includeWorkspace?: boolean;
  includeDiagnostics?: boolean;
  gitContext?: string;
}

export class ContextEngine {
  private indexer: WorkspaceIndexer;
  private retrieval: RetrievalEngine;

  constructor(indexer?: WorkspaceIndexer, retrieval?: RetrievalEngine) {
    this.indexer = indexer ?? new WorkspaceIndexer();
    this.retrieval = retrieval ?? new LexicalRetrievalEngine();
  }

  getIndexer(): WorkspaceIndexer {
    return this.indexer;
  }

  async assembleContext(
    query: string,
    options: ContextEngineOptions = {}
  ): Promise<AssembledContext> {
    const maxTokens = options.maxTokens ?? 16000;
    const budget = new ContextBudget(maxTokens);
    const items: ContextItem[] = [];

    // 1. Current Selection & Active Editor File
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const relPath = vscode.workspace.asRelativePath(editor.document.uri);
      const selection = editor.document.getText(editor.selection).trim();

      if (selection) {
        const alloc = budget.allocate('selection', selection, 3000);
        items.push({
          source: 'selection',
          label: `Selection in ${relPath}`,
          path: relPath,
          content: alloc.text,
          tokenEstimate: alloc.tokensUsed
        });
      } else {
        const fullDoc = editor.document.getText();
        const alloc = budget.allocate('active_file', fullDoc, 4000);
        items.push({
          source: 'active_file',
          label: `Active file: ${relPath}`,
          path: relPath,
          content: alloc.text,
          tokenEstimate: alloc.tokensUsed
        });
      }

      // Diagnostics at active file
      if (options.includeDiagnostics !== false && budget.getRemainingTokens() > 100) {
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        if (diagnostics.length) {
          const diagLines = diagnostics.slice(0, 8).map((d) => `[Line ${d.range.start.line + 1}] ${d.message}`);
          const alloc = budget.allocate('diagnostics', diagLines.join('\n'), 500);
          items.push({
            source: 'diagnostics',
            label: `${diagnostics.length} diagnostic(s) in ${relPath}`,
            path: relPath,
            content: alloc.text,
            tokenEstimate: alloc.tokensUsed
          });
        }
      }
    }

    // 2. Git Context if provided
    if (options.gitContext && budget.getRemainingTokens() > 200) {
      const alloc = budget.allocate('git_context', options.gitContext, 600);
      items.push({
        source: 'git',
        label: 'Git status & diff summary',
        content: alloc.text,
        tokenEstimate: alloc.tokensUsed
      });
    }

    // 3. Open Editor Tabs
    if (budget.getRemainingTokens() > 200) {
      try {
        const tabGroups = vscode.window.tabGroups.all;
        const openUris = tabGroups.flatMap((g) => g.tabs).flatMap((t) => {
          const input = t.input as { uri?: vscode.Uri } | undefined;
          return input?.uri ? [input.uri] : [];
        });

        const uniqueTabPaths = [...new Set(openUris.map((u) => vscode.workspace.asRelativePath(u)))].slice(0, 6);
        if (uniqueTabPaths.length) {
          const listText = uniqueTabPaths.map((p) => `- ${p}`).join('\n');
          const alloc = budget.allocate('open_tabs', listText, 250);
          items.push({
            source: 'open_tabs',
            label: `Open tabs (${uniqueTabPaths.length})`,
            content: alloc.text,
            tokenEstimate: alloc.tokensUsed
          });
        }
      } catch {}
    }

    // 4. Workspace Retrieval
    if (options.includeWorkspace && budget.getRemainingTokens() > 500 && vscode.workspace.isTrusted) {
      if (this.indexer.getDocuments().length === 0) {
        void this.indexer.indexWorkspace();
      }

      const docs = this.indexer.getDocuments();
      if (docs.length > 0) {
        const remainingTokens = budget.getRemainingTokens();
        const matches = await this.retrieval.retrieve(query, docs, {
          maxFiles: 5,
          maxChars: remainingTokens * 4,
          activeFileUri: editor?.document.uri.toString()
        });

        for (const match of matches) {
          if (budget.getRemainingTokens() < 100) break;
          const snippetText = `${match.path}:${match.startLine}\n\`\`\`\n${match.text}\n\`\`\``;
          const alloc = budget.allocate('workspace_retrieval', snippetText, 800);
          items.push({
            source: 'retrieval',
            label: `${match.path}:${match.startLine}`,
            path: match.path,
            content: alloc.text,
            tokenEstimate: alloc.tokensUsed
          });
        }
      }
    }

    // Build Formatted Prompt Text & Preview
    const promptSections: string[] = [];

    // Root Workspace grounding
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const rootFolder = vscode.workspace.workspaceFolders[0];
      let projectSummary = `Workspace: ${rootFolder.name}`;
      try {
        const pkgUri = vscode.Uri.joinPath(rootFolder.uri, 'package.json');
        const pkgBytes = await vscode.workspace.fs.readFile(pkgUri);
        const pkgData = JSON.parse(new TextDecoder().decode(pkgBytes));
        if (pkgData.name) {
          projectSummary += ` | Project: ${pkgData.name} (v${pkgData.version || '0.1.0'})${pkgData.description ? ' - ' + pkgData.description : ''}`;
        }
      } catch {}
      promptSections.push(projectSummary);
    }

    const activeFileItem = items.find((i) => i.source === 'active_file' || i.source === 'selection');
    if (activeFileItem) {
      promptSections.push(`Context - ${activeFileItem.label}:\n\`\`\`\n${activeFileItem.content}\n\`\`\``);
    }

    const diagItem = items.find((i) => i.source === 'diagnostics');
    if (diagItem) {
      promptSections.push(`Diagnostics:\n${diagItem.content}`);
    }

    const gitItem = items.find((i) => i.source === 'git');
    if (gitItem) {
      promptSections.push(`Git Context:\n${gitItem.content}`);
    }

    const retrievalItems = items.filter((i) => i.source === 'retrieval');
    if (retrievalItems.length) {
      promptSections.push(`Relevant workspace snippets:\n${retrievalItems.map((r) => r.content).join('\n\n')}`);
    }

    const totalTokens = budget.getTokensUsed();
    const summaryParts = items.map((i) => `[${i.label}]`);
    const summary = `${summaryParts.join(' ')} (${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens)`;

    return {
      promptText: promptSections.join('\n\n'),
      items,
      totalTokens,
      maxTokens,
      summary
    };
  }
}
