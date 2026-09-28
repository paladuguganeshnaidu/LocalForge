import * as vscode from 'vscode';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { findRelevantSnippets } from '../context/workspaceContext';
import { ModelToolDefinition } from '../providers/modelProvider';
import { WorkspaceToolExecutor } from './toolAgent';

const maximumReadBytes = 128 * 1024;

export const workspaceTools: ModelToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_workspace',
      description: 'Search the trusted workspace for code related to a query. Read-only.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, max_results: { type: 'integer', minimum: 1, maximum: 5 } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_workspace_file',
      description: 'Read a small text file using a path relative to the trusted workspace. Read-only.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
      }
    }
  }
];

export const executeWorkspaceTool: WorkspaceToolExecutor = async (name, args) => {
  if (!vscode.workspace.isTrusted) throw new Error('Workspace tools are disabled until this workspace is trusted.');
  if (name === 'search_workspace') {
    const query = getString(args.query, 'query', 1000);
    const maxResults = typeof args.max_results === 'number' && Number.isInteger(args.max_results)
      ? Math.min(5, Math.max(1, args.max_results))
      : 4;
    const snippets = await findRelevantSnippets(query, { maxFiles: maxResults, maxChars: 6000 });
    return snippets.map(({ path, startLine, text }) => ({ path, startLine, content: text }));
  }
  if (name === 'read_workspace_file') {
    const relativePath = getString(args.path, 'path', 500);
    const segments = validateRelativeWorkspacePath(relativePath);
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
    if (uri.scheme === 'file') {
      const realRoot = await realpath(root.uri.fsPath);
      const realFile = await realpath(uri.fsPath);
      const relativeFile = relative(realRoot, realFile);
      if (relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
        throw new Error('The requested file resolves outside the workspace folder.');
      }
    }
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File) throw new Error('Only regular workspace files can be read.');
    if (stat.size > maximumReadBytes) throw new Error('The requested file is too large to read through the agent.');
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.includes(0)) throw new Error('Binary files are not available to the agent.');
    return { path: vscode.workspace.asRelativePath(uri), content: new TextDecoder().decode(bytes).slice(0, 6000) };
  }
  throw new Error('Tool is not allow-listed.');
};

function getString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Tool argument “${name}” must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
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

