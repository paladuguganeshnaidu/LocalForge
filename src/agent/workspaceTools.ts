import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { exec } from 'node:child_process';
import { findRelevantSnippets } from '../context/workspaceContext';
import { ModelToolDefinition } from '../providers/modelProvider';
import { WorkspaceToolExecutor } from './toolAgent';

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

export const executeWorkspaceTool: WorkspaceToolExecutor = async (name, args) => {
  if (!vscode.workspace.isTrusted) throw new Error('Workspace tools are disabled until this workspace is trusted.');

  if (name === 'search_workspace') {
    const query = getString(args.query, 'query', 1000);
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
    const rel = typeof args.path === 'string' ? args.path.trim() : '';
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
    const uri = await resolveWorkspaceUri(relativePath, true);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    return { success: true, path: vscode.workspace.asRelativePath(uri), bytesWritten: content.length };
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
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
    return { success: true, path: vscode.workspace.asRelativePath(uri), replacedChars: target.length, newChars: replacement.length };
  }

  if (name === 'run_command') {
    const command = getString(args.command, 'command', 1000);
    validateCommandSafety(command);
    const rootPath = getWorkspaceRootUri().fsPath;
    return new Promise((resolve) => {
      exec(command, { cwd: rootPath, timeout: 30000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
        resolve({
          command,
          exitCode: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0),
          stdout: (stdout || '').trim().slice(0, 8000),
          stderr: (stderr || '').trim().slice(0, 4000)
        });
      });
    });
  }

  throw new Error(`Tool “${name}” is not allow-listed.`);
};

function getString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Tool argument “${name}” must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function getWorkspaceRootUri(): vscode.Uri {
  const roots = vscode.workspace.workspaceFolders ?? [];
  if (!roots.length) throw new Error('Open a workspace folder first.');
  return roots[0].uri;
}

async function resolveWorkspaceUri(inputPath: string, allowNew = false): Promise<vscode.Uri> {
  const segments = validateRelativeWorkspacePath(inputPath);
  const roots = vscode.workspace.workspaceFolders ?? [];
  if (!roots.length) throw new Error('Open a workspace folder first.');
  let root = roots[0];
  if (roots.length > 1) {
    const matching = roots.find((folder) => folder.name === segments[0]);
    if (matching) {
      root = matching;
      segments.shift();
    }
  }
  const uri = vscode.Uri.joinPath(root.uri, ...segments);
  if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
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
  const segments = relativePath.split('/');
  if (!relativePath || relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Provide a normalized relative path inside the workspace.');
  }
  return segments;
}
