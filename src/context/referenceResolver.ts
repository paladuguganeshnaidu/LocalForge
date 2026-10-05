import * as vscode from 'vscode';
import { GitContextService } from './gitContext';
import { TerminalManager } from '../terminal/terminalManager';
import { canAttachWorkspaceContext } from './accessBoundary';
import { validateWorkspaceRelativePath } from '../core/workspacePaths';

export interface ResolvedContextReference {
  type: 'file' | 'selection' | 'terminal' | 'diagnostics' | 'git';
  label: string;
  content: string;
}

export interface ParsedSlashCommand {
  command?: 'plan' | 'diff' | 'search' | 'terminal' | 'model' | 'context' | 'diagnose' | 'remote' | 'clear';
  cleanPrompt: string;
}

export class ContextReferenceResolver {
  constructor(
    private readonly gitContext?: GitContextService,
    private readonly terminalManager?: TerminalManager
  ) {}

  public parseSlashCommand(input: string): ParsedSlashCommand {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { cleanPrompt: trimmed };
    }

    const match = /^\/([a-zA-Z]+)(?:\s+(.*))?$/s.exec(trimmed);
    if (!match) {
      return { cleanPrompt: trimmed };
    }

    const rawCmd = match[1].toLowerCase();
    const cleanPrompt = (match[2] || '').trim();

    const validCommands = ['plan', 'diff', 'search', 'terminal', 'model', 'context', 'diagnose', 'remote', 'clear'] as const;
    const found = validCommands.find((c) => c === rawCmd);

    return {
      command: found,
      cleanPrompt
    };
  }

  public async resolveReferences(prompt: string, workspaceRoot?: vscode.Uri): Promise<{
    cleanedPrompt: string;
    references: ResolvedContextReference[];
  }> {
    const references: ResolvedContextReference[] = [];
    let cleaned = prompt;

    // 1. @selection
    if (/@selection\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/@selection\b/gi, '').trim();
      const editor = vscode.window.activeTextEditor;
      if (editor && !editor.selection.isEmpty && await canAttachWorkspaceContext(editor.document.uri)) {
        references.push({
          type: 'selection',
          label: `Selection in ${vscode.workspace.asRelativePath(editor.document.uri)}`,
          content: editor.document.getText(editor.selection)
        });
      }
    }

    // 2. @terminal
    if (/@terminal\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/@terminal\b/gi, '').trim();
      const lastProc = this.terminalManager?.getAllProcesses().at(-1);
      if (lastProc) {
        const out = lastProc.stdout || lastProc.stderr || 'No output captured.';
        references.push({
          type: 'terminal',
          label: `Terminal: ${lastProc.command}`,
          content: out.slice(-4000)
        });
      }
    }

    // 3. @diagnostics
    if (/@diagnostics\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/@diagnostics\b/gi, '').trim();
      const editor = vscode.window.activeTextEditor;
      if (editor && await canAttachWorkspaceContext(editor.document.uri)) {
        const diags = vscode.languages.getDiagnostics(editor.document.uri);
        if (diags.length) {
          const list = diags.slice(0, 10).map((d) => `[Line ${d.range.start.line + 1}] ${d.message}`).join('\n');
          references.push({
            type: 'diagnostics',
            label: `Diagnostics (${diags.length} issues)`,
            content: list
          });
        }
      }
    }

    // 4. @git
    if (/@git\b/i.test(cleaned)) {
      cleaned = cleaned.replace(/@git\b/gi, '').trim();
      if (this.gitContext && workspaceRoot) {
        const gitState = await this.gitContext.getWorkspaceGitState(workspaceRoot);
        if (gitState.isGitRepo) {
          references.push({
            type: 'git',
            label: `Git: branch ${gitState.branch || 'unknown'}`,
            content: `Status:\n${gitState.statusSummary}\n\nDiff Summary:\n${gitState.diffSummary || 'None'}`
          });
        }
      }
    }

    // 5. @file:path or @path/to/file
    const fileRefPattern = /@file:("(?:[^"\\]|\\.)*")|@(?:file:)?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)\b/g;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = fileRefPattern.exec(cleaned)) !== null) {
      const filePath: string = fileMatch[1] ? JSON.parse(fileMatch[1]) : fileMatch[2];
      if (workspaceRoot) {
        try {
          const uri = vscode.Uri.joinPath(workspaceRoot, ...validateWorkspaceRelativePath(filePath));
          if (!await canAttachWorkspaceContext(uri)) throw new Error('This file requires a separately approved read tool and was not attached automatically.');
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.File || stat.size > 256 * 1024) throw new Error('Reference must be a regular text file up to 256 KiB.');
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.includes(0)) throw new Error('Binary reference was not attached.');
          const text = new TextDecoder().decode(bytes);
          references.push({
            type: 'file',
            label: filePath,
            content: text.slice(0, 10000)
          });
        } catch (error) {
          references.push({ type: 'file', label: filePath, content: `Not attached: ${error instanceof Error ? error.message : 'File is unavailable.'}` });
        }
      }
    }
    cleaned = cleaned.replace(fileRefPattern, '').trim();

    return { cleanedPrompt: cleaned, references };
  }
}
