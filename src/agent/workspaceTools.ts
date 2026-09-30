import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { exec } from 'node:child_process';
import { findRelevantSnippets } from '../context/workspaceContext';
import { ModelToolDefinition } from '../providers/modelProvider';
import { WorkspaceToolExecutor } from './toolAgent';
import { EditEngine } from '../editing/editEngine';
import { TerminalManager } from '../terminal/terminalManager';
import { assertWorkspacePath, normalizeWorkspaceRelativePath } from '../security/pathPolicy';
import { assertAllowedCommand } from '../security/commandPolicy';
import { redactString } from '../security/secretRedactor';

const maximumReadBytes = 128 * 1024;
const maximumWriteBytes = 512 * 1024;

export const readOnlyWorkspaceTools: ModelToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_workspace',
      description: 'Search the trusted workspace for code related to a query. Read-only.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Keyword or concept to search' }, max_results: { type: 'integer', minimum: 1, maximum: 8 } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description: 'Read a text file using a path relative to the trusted workspace. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the workspace file' },
          start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based start line' },
          end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based end line' }
        },
        required: ['path'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories within a workspace folder path. Read-only.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Relative path to directory, or empty for root' } },
        required: ['path'],
        additionalProperties: false
      }
    }
  }
];

export const allWorkspaceTools: ModelToolDefinition[] = [
  ...readOnlyWorkspaceTools,
  {
    type: 'function',
    function: {
      name: 'write_workspace_file',
      description: 'Create a new file or completely overwrite an existing file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative workspace file path to write' },
          content: { type: 'string', description: 'The complete file text content' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_workspace_file',
      description: 'Surgically replace a unique block of text inside an existing workspace file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to file to edit' },
          target_content: { type: 'string', description: 'The exact lines of code to replace (must match uniquely)' },
          replacement_content: { type: 'string', description: 'The new code to put in place of target_content' }
        },
        required: ['path', 'target_content', 'replacement_content'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a non-destructive terminal shell command in the root of the workspace.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute (e.g. npm test, git status, cargo check)' }
        },
        required: ['command'],
        additionalProperties: false
      }
    }
  }
];

// Backwards-compatible alias for existing tests
export const workspaceTools = allWorkspaceTools;

export interface WorkspaceToolContext {
  editEngine?: EditEngine;
  terminalManager?: TerminalManager;
  conversationId?: string;
  turnId?: string;
  autoApply?: boolean;
  signal?: AbortSignal;
}

export const executeWorkspaceTool: WorkspaceToolExecutor = async (name, args, toolContext?: WorkspaceToolContext) => {
  if (!vscode.workspace.isTrusted) throw new Error('Workspace tools are disabled until this workspace is trusted.');

  if (name === 'search_workspace') {
    let query = '';
    try {
      query = getString(args.query, 'query', 1000);
    } catch {
      query = '';
    }
    const maxResults = typeof args.max_results === 'number' && Number.isInteger(args.max_results)
      ? Math.min(8, Math.max(1, args.max_results))
      : 4;
    const snippets = await findRelevantSnippets(query, { maxFiles: maxResults, maxChars: 6000 });
    return snippets.map(({ path, startLine, text }) => ({ path, startLine, content: text }));
  }

  if (name === 'read_workspace_file') {
    const relativePath = getString(args.path, 'path', 500);
    const uri = await resolveWorkspaceUri(relativePath);
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) throw new Error('Only regular workspace files can be read.');
    if (stat.size > maximumReadBytes) throw new Error('The requested file is too large to read through the agent.');
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) throw new Error('Binary files are not available to the agent.');
    const fullText = new TextDecoder().decode(bytes);

    const startLine = typeof args.start_line === 'number' && args.start_line > 0 ? args.start_line : undefined;
    const endLine = typeof args.end_line === 'number' && args.end_line > 0 ? args.end_line : undefined;

    if (startLine !== undefined || endLine !== undefined) {
      const lines = fullText.split(/\r?\n/);
      const start = (startLine ?? 1) - 1;
      const end = endLine ?? lines.length;
      const window = lines.slice(start, end).join('\n');
      return { path: vscode.workspace.asRelativePath(uri), totalLines: lines.length, content: window.slice(0, 10000) };
    }

    return { path: vscode.workspace.asRelativePath(uri), content: fullText.slice(0, 10000) };
  }

  if (name === 'list_directory') {
    const raw = typeof args.path === 'string' ? args.path.trim() : '';
    const rel = (!raw || raw === '.' || raw === './') ? '' : raw;
    const uri = rel ? await resolveWorkspaceUri(rel) : getWorkspaceRootUri();
    const entries = await vscode.workspace.fs.readDirectory(uri);
    return entries.map(([entryName, type]) => ({
      name: entryName,
      type: type === vscode.FileType.Directory ? 'dir' : 'file'
    })).filter((entry) => !entry.name.startsWith('.git') && entry.name !== 'node_modules').slice(0, 50);
  }

  if (name === 'write_workspace_file') {
    const relativePath = getString(args.path, 'path', 500);
    const content = typeof args.content === 'string' ? args.content : '';
    if (content.length > maximumWriteBytes) throw new Error('File content exceeds maximum write size.');

    if (toolContext?.editEngine) {
      const workspaceRoot = getWorkspaceRootUri();
      const proposal = await toolContext.editEngine.proposeEdits(
        workspaceRoot,
        [{ path: relativePath, newContent: content }],
        `Write ${relativePath}`,
        { conversationId: toolContext.conversationId, turnId: toolContext.turnId }
      );

      if (toolContext.autoApply) {
        const applyRes = await toolContext.editEngine.applyProposal(proposal.id);
        if (!applyRes.success) {
          throw new Error(`Failed to apply proposal for ${relativePath}: ${applyRes.errors.map((e) => e.error).join(', ')}`);
        }
        return { success: true, path: relativePath, proposalId: proposal.id, applied: true, bytesWritten: content.length };
      }

      return {
        success: true,
        path: relativePath,
        proposalId: proposal.id,
        status: 'pending',
        proposed: true,
        additions: proposal.additions,
        deletions: proposal.deletions,
        message: `Proposed file write for ${relativePath}. Awaiting user review and approval.`
      };
    }

    throw new Error('Autonomous workspace writes require the canonical EditEngine.');
  }

  if (name === 'edit_workspace_file') {
    const relativePath = getString(args.path, 'path', 500);
    const target = getString(args.target_content, 'target_content', 50000);
    const replacement = typeof args.replacement_content === 'string' ? args.replacement_content : '';
    const uri = await resolveWorkspaceUri(relativePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const existing = new TextDecoder().decode(bytes);

    const occurrences = existing.split(target).length - 1;
    if (occurrences === 0) {
      throw new Error(`Target content was not found in ${relativePath}. Make sure whitespace and line breaks match.`);
    }
    if (occurrences > 1) {
      throw new Error(`Target content was found ${occurrences} times in ${relativePath}. Provide a larger unique snippet.`);
    }

    const updated = existing.replace(target, replacement);

    if (toolContext?.editEngine) {
      const workspaceRoot = getWorkspaceRootUri();
      const proposal = await toolContext.editEngine.proposeEdits(
        workspaceRoot,
        [{ path: relativePath, newContent: updated }],
        `Edit ${relativePath}`,
        { conversationId: toolContext.conversationId, turnId: toolContext.turnId }
      );

      if (toolContext.autoApply) {
        const applyRes = await toolContext.editEngine.applyProposal(proposal.id);
        if (!applyRes.success) {
          throw new Error(`Failed to apply proposal for ${relativePath}: ${applyRes.errors.map((e) => e.error).join(', ')}`);
        }
        return { success: true, path: relativePath, proposalId: proposal.id, applied: true, replacedChars: target.length, newChars: replacement.length };
      }

      return {
        success: true,
        path: relativePath,
        proposalId: proposal.id,
        status: 'pending',
        proposed: true,
        additions: proposal.additions,
        deletions: proposal.deletions,
        message: `Proposed file edit for ${relativePath}. Awaiting user review and approval.`
      };
    }

    throw new Error('Autonomous workspace edits require the canonical EditEngine.');
  }

  if (name === 'run_command') {
    const command = getString(args.command, 'command', 1000);
    assertAllowedCommand(command);
    const rootPath = getWorkspaceRootUri().fsPath;

    if (toolContext?.terminalManager) {
      const proc = await toolContext.terminalManager.runCommand(command, rootPath, false, 60000, toolContext.signal);
      return {
        command: proc.command,
        exitCode: proc.exitCode ?? 0,
        stdout: (proc.stdout || '').trim().slice(0, 8000),
        stderr: (proc.stderr || '').trim().slice(0, 4000),
        durationMs: proc.duration
      };
    }

    throw new Error('TerminalManager is required for canonical workspace command execution.');
  }

  throw new Error(`Tool “${name}” is not allow-listed.`);
};

function getString(value: unknown, name: string, maxLength: number): string {
  let resolved: string | undefined;
  if (typeof value === 'string') {
    resolved = value;
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of [name, 'value', 'text', 'content', 'path', 'query', 'command', 'cmd', 'file']) {
      if (typeof obj[k] === 'string' && (obj[k] as string).trim()) {
        resolved = obj[k] as string;
        break;
      }
    }
  }
  if (!resolved || !resolved.trim() || resolved.length > maxLength) {
    throw new Error(`Tool argument “${name}” must be a non-empty string up to ${maxLength} characters.`);
  }
  return resolved.trim();
}

function getWorkspaceRootUri(): vscode.Uri {
  const roots = vscode.workspace.workspaceFolders ?? [];
  if (!roots.length) throw new Error('Open a workspace folder first.');
  return roots[0].uri;
}

async function resolveWorkspaceUri(inputPath: string, allowNew = false): Promise<vscode.Uri> {
  let cleaned = inputPath.replace(/\\/g, '/').trim();
  while (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2).trim();
  }
  const segments = validateRelativeWorkspacePath(cleaned);
  const roots = vscode.workspace.workspaceFolders ?? [];
  if (!roots.length) throw new Error('Open a workspace folder first.');
  let root = roots[0];
  if (roots.length > 1 && segments.length > 0) {
    const matching = roots.find((folder) => folder.name === segments[0]);
    if (matching) {
      root = matching;
      segments.shift();
    }
  }
  const uri = vscode.Uri.joinPath(root.uri, ...segments);
  if (vscode.workspace.getWorkspaceFolder && vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    throw new Error('The requested path is outside the selected workspace folder.');
  }
  if (!allowNew && uri.scheme === 'file') {
    const realRoot = await realpath(root.uri.fsPath);
    const realFile = await realpath(uri.fsPath);
    const relativeFile = relative(realRoot, realFile);
    if (relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
      throw new Error('The requested file resolves outside the workspace folder.');
    }
  }
  return uri;
}

function validateCommandSafety(cmd: string): void {
  const normalized = cmd.trim().toLowerCase();
  const dangerousPatterns = [
    /\brm\s+-rf\s+[\/\\]/i,
    /\bdel\s+\/[sfq]\s+c:\\/i,
    /\bformat\s+[a-z]:/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /:(){ :|:& };:/
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalized)) {
      throw new Error('Command contains potentially catastrophic system operations and was blocked.');
    }
  }
}

export function validateRelativeWorkspacePath(inputPath: string): string[] {
  const relativePath = inputPath.replace(/\\/g, '/').trim();

  // Reject UNC paths and protocol escapes
  if (relativePath.startsWith('//') || relativePath.startsWith('\\\\')) {
    throw new Error('Provide a normalized relative path inside the workspace (UNC paths are not permitted).');
  }

  // Reject absolute paths and empty inputs
  if (!relativePath || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error('Provide a normalized relative path inside the workspace.');
  }

  const segments = relativePath.split('/');
  const reservedDevices = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Provide a normalized relative path inside the workspace.');
    }
    if (reservedDevices.test(segment)) {
      throw new Error(`Provide a normalized relative path inside the workspace (Windows reserved device name "${segment}" is not allowed).`);
    }
  }

  return segments;
}
