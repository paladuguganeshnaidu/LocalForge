import * as vscode from 'vscode';
import { WorkspaceIndexer } from './workspaceIndexer';
import { LexicalRetrievalEngine, RetrievalEngine, SearchMatch } from './retrieval';

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
    const maxChars = maxTokens * 4;
    let remainingChars = maxChars;
    const items: ContextItem[] = [];

    // 1. Current Selection & Active Editor File
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const relPath = vscode.workspace.asRelativePath(editor.document.uri);
      const selection = editor.document.getText(editor.selection).trim();

      if (selection) {
        const itemChars = Math.min(selection.length, 12000);
        const content = selection.slice(0, itemChars);
        remainingChars -= itemChars;
        items.push({
          source: 'selection',
          label: `Selection in ${relPath}`,
          path: relPath,
          content,
          tokenEstimate: Math.ceil(content.length / 4)
        });
      } else {
        const fullDoc = editor.document.getText();
        const itemChars = Math.min(fullDoc.length, 16000);
        const content = fullDoc.slice(0, itemChars);
        remainingChars -= itemChars;
        items.push({
          source: 'active_file',
          label: `Active file: ${relPath}`,
          path: relPath,
          content,
          tokenEstimate: Math.ceil(content.length / 4)
        });
      }

      // Diagnostics at active file
      if (options.includeDiagnostics !== false) {
        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        if (diagnostics.length) {
          const diagLines = diagnostics.slice(0, 8).map((d) => `[Line ${d.range.start.line + 1}] ${d.message}`);
          const diagContent = diagLines.join('\n');
          items.push({
            source: 'diagnostics',
            label: `${diagnostics.length} diagnostic(s) in ${relPath}`,
            path: relPath,
            content: diagContent,
            tokenEstimate: Math.ceil(diagContent.length / 4)
          });
        }
      }
    }

    // 2. Open Editor Tabs
    try {
      const tabGroups = vscode.window.tabGroups.all;
      const openUris = tabGroups.flatMap((g) => g.tabs).flatMap((t) => {
        const input = t.input as { uri?: vscode.Uri } | undefined;
        return input?.uri ? [input.uri] : [];
      });

      const uniqueTabPaths = [...new Set(openUris.map((u) => vscode.workspace.asRelativePath(u)))].slice(0, 6);
      if (uniqueTabPaths.length) {
        const listText = uniqueTabPaths.map((p) => `- ${p}`).join('\n');
        items.push({
          source: 'open_tabs',
          label: `Open tabs (${uniqueTabPaths.length})`,
          content: listText,
          tokenEstimate: Math.ceil(listText.length / 4)
        });
      }
    } catch {}

    // 3. Workspace Retrieval
    if (options.includeWorkspace && remainingChars > 2000 && vscode.workspace.isTrusted) {
      // Ensure index has documents
      if (this.indexer.getDocuments().length === 0) {
        await this.indexer.indexWorkspace();
      }

      const matches = await this.retrieval.retrieve(query, this.indexer.getDocuments(), {
        maxFiles: 5,
        maxChars: Math.min(remainingChars, 14000),
        activeFileUri: editor?.document.uri.toString()
      });

      for (const match of matches) {
        const snippetText = `${match.path}:${match.startLine}\n\`\`\`\n${match.text}\n\`\`\``;
        items.push({
          source: 'retrieval',
          label: `${match.path}:${match.startLine}`,
          path: match.path,
          content: snippetText,
          tokenEstimate: Math.ceil(snippetText.length / 4)
        });
      }
    }

    // Build Formatted Prompt Text & Preview
    let promptSections: string[] = [];

    const activeFileItem = items.find((i) => i.source === 'active_file' || i.source === 'selection');
    if (activeFileItem) {
      promptSections.push(`Context - ${activeFileItem.label}:\n\`\`\`\n${activeFileItem.content}\n\`\`\``);
    }

    const diagItem = items.find((i) => i.source === 'diagnostics');
    if (diagItem) {
      promptSections.push(`Diagnostics:\n${diagItem.content}`);
    }

    const retrievalItems = items.filter((i) => i.source === 'retrieval');
    if (retrievalItems.length) {
      promptSections.push(`Relevant workspace snippets:\n${retrievalItems.map((r) => r.content).join('\n\n')}`);
    }

    const totalChars = items.reduce((acc, i) => acc + i.content.length, 0);
    const totalTokens = Math.ceil(totalChars / 4);

    const summaryParts = items.map((i) => `✓ ${i.label}`);
    const summary = `${summaryParts.join(' · ')} (${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens)`;

    return {
      promptText: promptSections.join('\n\n'),
      items,
      totalTokens,
      maxTokens,
      summary
    };
  }
}
