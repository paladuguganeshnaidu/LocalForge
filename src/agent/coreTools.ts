import * as vscode from 'vscode';
import { assertWorkspaceFilePath, validateWorkspaceRelativePath } from '../core/workspacePaths';
import { exec, execFile } from 'node:child_process';
import { ModelToolDefinition } from '../providers/modelProvider';
import { ToolRegistry } from './toolRegistry';
import { EditEngine, EditProposal } from '../editing/editEngine';
import { computeContentHash } from '../editing/patchService';
import { TerminalManager } from '../terminal/terminalManager';
import { ArtifactManager } from '../core/artifactManager';
import { BrowserTool } from '../browser/browserTool';
import { findRelevantSnippets } from '../context/workspaceContext';
import { canAttachWorkspaceContext } from '../context/accessBoundary';

const maximumReadBytes = 256 * 1024;
const maximumWriteBytes = 512 * 1024;

export interface CoreToolContext {
  editEngine?: EditEngine;
  terminalManager?: TerminalManager;
  artifactManager?: ArtifactManager;
  browserTool?: BrowserTool;
  autoApply?: boolean | (() => boolean);
}

export function registerAllCoreTools(registry: ToolRegistry, context: CoreToolContext): void {
  if (context.editEngine) {
    const editEngine = context.editEngine;
    registry.registerTool({
      type: 'function', function: {
        name: 'get_edit_recovery', description: 'List local edit recovery metadata and IDs without exposing source backups.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    }, async () => editEngine.getRecoveryHistory(), { category: 'read', riskLevel: 'read_only' });
    registry.registerTool({
      type: 'function', function: {
        name: 'rollback_changes', description: 'Restore a recorded edit to its exact original file state, deleting newly created files. Requires explicit approval and refuses changed files.',
        parameters: {
          type: 'object', properties: {
            recoveryId: { type: 'string', description: 'Recovery ID returned by get_edit_recovery' },
            files: { type: 'array', items: { type: 'string' }, description: 'Optional recorded file paths to restore' }
          }, required: ['recoveryId'], additionalProperties: false
        }
      }
    }, async (args, execution) => {
      if (args.files !== undefined && (!Array.isArray(args.files) || !args.files.every((path) => typeof path === 'string'))) throw new Error('Rollback files must be an array of recorded relative paths.');
      return editEngine.rollbackChanges(getString(args.recoveryId, 'recoveryId', 100), args.files as string[] | undefined, execution.signal);
    }, { category: 'edit', riskLevel: 'destructive', requiresApproval: true });
  }
  // 1. read_file
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file within the workspace with optional line windowing.',
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
    async (args) => {
      const relPath = getString(args.path, 'path', 500);
      const uri = await resolveWorkspaceUri(relPath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) throw new Error('Only regular workspace files can be read.');
      if (stat.size > maximumReadBytes) throw new Error('File is too large to read (max 256KB).');
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.includes(0)) throw new Error('Binary files cannot be read.');
      const text = new TextDecoder().decode(bytes);

      const startLine = typeof args.start_line === 'number' && args.start_line > 0 ? args.start_line : undefined;
      const endLine = typeof args.end_line === 'number' && args.end_line > 0 ? args.end_line : undefined;

      if (startLine !== undefined || endLine !== undefined) {
        const lines = text.split(/\r?\n/);
        const start = (startLine ?? 1) - 1;
        const end = endLine ?? lines.length;
        const window = lines.slice(start, end).join('\n');
        return { path: vscode.workspace.asRelativePath(uri), totalLines: lines.length, content: window };
      }
      return { path: vscode.workspace.asRelativePath(uri), content: text };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 2. read_files
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'read_files',
        description: 'Read multiple workspace files in batch (up to 10 files).',
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of relative workspace file paths'
            }
          },
          required: ['paths'],
          additionalProperties: false
        }
      }
    },
    async (args) => {
      if (!Array.isArray(args.paths)) throw new Error('Argument "paths" must be an array of strings.');
      const paths = args.paths.slice(0, 10) as string[];
      const results: Array<{ path: string; content?: string; error?: string }> = [];

      for (const p of paths) {
        try {
          const uri = await resolveWorkspaceUri(p);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.File || stat.size > maximumReadBytes) throw new Error('Read requires a regular workspace file up to 256 KiB.');
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.includes(0) || bytes.byteLength > maximumReadBytes) throw new Error('The file is binary or exceeds the read limit.');
          results.push({ path: p, content: new TextDecoder().decode(bytes).slice(0, 10000) });
        } catch (err: any) {
          results.push({ path: p, error: err.message || String(err) });
        }
      }
      return { files: results };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 3. write_file
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file' },
            content: { type: 'string', description: 'File content' }
          },
          required: ['path', 'content'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const relPath = getString(args.path, 'path', 500);
      const content = getFileContent(args.content, 'content');
      await resolveWorkspaceUri(relPath, true);
      execution.signal.throwIfAborted();
      const editEngine = requireEditEngine(context);
      const proposal = await editEngine.proposeEdits(getWorkspaceRootUri(), [{ path: relPath, newContent: content }], `Write ${relPath}`, undefined, execution.signal);
      return submitFileProposal(context, proposal, { path: relPath }, execution.signal);
    },
    { category: 'edit', riskLevel: 'low_risk' }
  );

  // 4. create_file
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'create_file',
        description: 'Create a new file only if it does not already exist.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to new file' },
            content: { type: 'string', description: 'Initial file content' }
          },
          required: ['path', 'content'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const relPath = getString(args.path, 'path', 500);
      const content = getFileContent(args.content, 'content');
      await resolveWorkspaceUri(relPath, true);
      execution.signal.throwIfAborted();
      const proposal = await requireEditEngine(context).proposeEdits(getWorkspaceRootUri(), [
        { path: relPath, newContent: content, operation: 'create' }
      ], `Create ${relPath}`, undefined, execution.signal);
      return submitFileProposal(context, proposal, { path: relPath, operation: 'create' }, execution.signal);
    },
    { category: 'edit', riskLevel: 'low_risk' }
  );

  // 5. replace_range
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'replace_range',
        description: 'Surgically replace lines in a file by 1-based line range (start_line to end_line).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file' },
            start_line: { type: 'integer', minimum: 1, description: '1-based start line' },
            end_line: { type: 'integer', minimum: 1, description: '1-based end line' },
            replacement: { type: 'string', description: 'Replacement content' }
          },
          required: ['path', 'start_line', 'end_line', 'replacement'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const relPath = getString(args.path, 'path', 500);
      const startLine = Number(args.start_line);
      const endLine = Number(args.end_line);
      const replacement = getFileContent(args.replacement, 'replacement');

      const uri = await resolveWorkspaceUri(relPath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.length > maximumWriteBytes || bytes.includes(0)) throw new Error('Line replacement requires a text file up to 512KB.');
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);

      if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine > lines.length) {
        throw new Error(`Invalid line range: ${startLine} to ${endLine} (file has ${lines.length} lines).`);
      }

      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(endLine);
      const newLines = replacement ? replacement.split(/\r?\n/) : [];
      const newline = new TextDecoder().decode(bytes).includes('\r\n') ? '\r\n' : '\n';
      const updated = [...before, ...newLines, ...after].join(newline);
      getFileContent(updated, 'updated content');

      execution.signal.throwIfAborted();
      const proposal = await requireEditEngine(context).proposeEdits(getWorkspaceRootUri(), [
        { path: relPath, newContent: updated, expectedOriginalHash: computeContentHash(bytes) }
      ], `Replace lines ${startLine}-${endLine} in ${relPath}`, undefined, execution.signal);
      return submitFileProposal(context, proposal, { path: relPath, replacedLines: endLine - startLine + 1 }, execution.signal);
    },
    { category: 'edit', riskLevel: 'low_risk' }
  );

  // 6. delete_file
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'delete_file',
        description: 'Delete a file within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file to delete' }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const relPath = getString(args.path, 'path', 500);
      await resolveWorkspaceUri(relPath);
      execution.signal.throwIfAborted();
      const proposal = await requireEditEngine(context).proposeEdits(getWorkspaceRootUri(), [
        { path: relPath, newContent: '', operation: 'delete' }
      ], `Delete ${relPath}`, undefined, execution.signal);
      return submitFileProposal(context, proposal, { path: relPath, operation: 'delete' }, execution.signal);
    },
    { category: 'edit', riskLevel: 'destructive', requiresApproval: true }
  );

  // 7. move_file / rename_file
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'move_file',
        description: 'Move or rename a file within the workspace.',
        parameters: {
          type: 'object',
          properties: {
            source_path: { type: 'string', description: 'Current relative file path' },
            destination_path: { type: 'string', description: 'New relative file path' }
          },
          required: ['source_path', 'destination_path'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const srcPath = getString(args.source_path, 'source_path', 500);
      const dstPath = getString(args.destination_path, 'destination_path', 500);
      await resolveWorkspaceUri(srcPath);
      await resolveWorkspaceUri(dstPath, true);
      execution.signal.throwIfAborted();
      const proposal = await requireEditEngine(context).proposeMove(getWorkspaceRootUri(), srcPath, dstPath, execution.signal);
      return submitFileProposal(context, proposal, { from: srcPath, to: dstPath, operation: 'move' }, execution.signal);
    },
    { category: 'edit', riskLevel: 'destructive', requiresApproval: true }
  );

  // 8. list_directory
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List contents of a directory in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to directory, or empty for root' }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    },
    async (args) => {
      const supplied = args.path ?? args.directory ?? args.dir ?? args.directory_path;
      if (typeof supplied !== 'string') throw new Error('list_directory requires a path string. Use path: "" for the workspace root, or read_file for a file.');
      const rel = supplied.trim();
      const uri = rel ? await resolveWorkspaceUri(rel) : getWorkspaceRootUri();
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.Directory) throw new Error(`"${rel || '(workspace root)'}" is not a directory. Use read_file with this path to read a file, or list_directory with its parent directory.`);
      const entries = await vscode.workspace.fs.readDirectory(uri);
      return entries
        .map(([name, type]) => ({
          name,
          type: type === vscode.FileType.Directory ? 'dir' : 'file'
        }))
        .filter((e) => !e.name.startsWith('.git') && e.name !== 'node_modules')
        .slice(0, 100);
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 9. search_text
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'search_text',
        description: 'Search workspace files for a text pattern or regular expression.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or regex' },
            max_results: { type: 'integer', minimum: 1, maximum: 20 }
          },
          required: ['query'],
          additionalProperties: false
        }
      }
    },
    async (args) => {
      const query = getString(args.query, 'query', 500);
      const maxResults = typeof args.max_results === 'number' ? Math.min(20, Math.max(1, args.max_results)) : 8;
      const snippets = await findRelevantSnippets(query, { maxFiles: maxResults, maxChars: 12000 });
      return { matches: snippets.map((s) => ({ path: s.path, line: s.startLine, snippet: s.text })) };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 10. search_files
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'search_files',
        description: 'Find workspace files matching a glob or filename pattern.',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.ts or *service*)' },
            max_results: { type: 'integer', minimum: 1, maximum: 50 }
          },
          required: ['pattern'],
          additionalProperties: false
        }
      }
    },
    async (args) => {
      const pattern = getString(args.pattern, 'pattern', 200);
      const maxResults = typeof args.max_results === 'number' ? Math.min(50, Math.max(1, args.max_results)) : 20;
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', maxResults);
      return { files: uris.map((u) => vscode.workspace.asRelativePath(u)) };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 11. git_status
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'git_status',
        description: 'Inspect the current git status and branch in the workspace.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async (_args, execution) => {
      const root = getWorkspaceRootUri().fsPath;
      return new Promise((resolve) => {
        exec('git status --short --branch', { cwd: root, timeout: 15000, signal: execution.signal }, (err, stdout, stderr) => {
          resolve({ status: (stdout || stderr || '').trim(), error: err ? err.message : undefined });
        });
      });
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 12. git_diff
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'git_diff',
        description: 'Get current git diff (staged or unstaged).',
        parameters: {
          type: 'object',
          properties: {
            staged: { type: 'boolean', description: 'If true, inspect staged changes' }
          },
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const root = getWorkspaceRootUri().fsPath;
      const flag = args.staged ? '--staged' : '';
      return new Promise((resolve) => {
        exec(`git diff ${flag}`, { cwd: root, timeout: 20000, maxBuffer: 1024 * 1024, signal: execution.signal }, (err, stdout, stderr) => {
          resolve({ diff: (stdout || stderr || '').slice(0, 50000), error: err ? err.message : undefined });
        });
      });
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 13. git_log
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'git_log',
        description: 'View recent git commit logs.',
        parameters: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of commits' }
          },
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const root = getWorkspaceRootUri().fsPath;
      const count = typeof args.count === 'number' ? Math.min(20, Math.max(1, args.count)) : 5;
      return new Promise((resolve) => {
        exec(`git log -n ${count} --oneline`, { cwd: root, timeout: 15000, signal: execution.signal }, (err, stdout, stderr) => {
          resolve({ log: (stdout || stderr || '').trim(), error: err ? err.message : undefined });
        });
      });
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 14. git_commit
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'git_commit',
        description: 'Create a git commit with staged changes.',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['message'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const root = getWorkspaceRootUri().fsPath;
      const message = getString(args.message, 'message', 300);
      return new Promise((resolve) => {
        execFile('git', ['commit', '-m', message], { cwd: root, timeout: 15000, signal: execution.signal }, (err, stdout, stderr) => {
          resolve({
            success: !err,
            output: (stdout || stderr || '').trim(),
            exitCode: err ? (err.code ?? 1) : 0
          });
        });
      });
    },
    { category: 'execute', riskLevel: 'low_risk', requiresApproval: true }
  );

  // 15. run_command
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a terminal shell command in the workspace root.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' }
          },
          required: ['command'],
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      const command = getString(args.command, 'command', 1000);
      if (!vscode.workspace.isTrusted) throw new Error('Terminal execution is blocked because the workspace is not trusted.');
      validateCommandSafety(command);
      const rootPath = getWorkspaceRootUri().fsPath;

      if (context.terminalManager) {
        const proc = await context.terminalManager.runCommand(command, rootPath, false, 60000, execution.signal);
        return {
          command: proc.command,
          cwd: proc.cwd,
          shell: proc.shell,
          startedAt: proc.startTime,
          processId: proc.processId,
          status: proc.status,
          exitCode: proc.exitCode ?? null,
          stdout: (proc.stdout || '').trim().slice(0, 10000),
          stderr: (proc.stderr || '').trim().slice(0, 5000),
          durationMs: proc.duration
        };
      }

      return new Promise((resolve) => {
        exec(command, { cwd: rootPath, timeout: 30000, maxBuffer: 512 * 1024, signal: execution.signal }, (error, stdout, stderr) => {
          resolve({
            command,
            exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
            stdout: (stdout || '').trim().slice(0, 10000),
            stderr: (stderr || '').trim().slice(0, 5000)
          });
        });
      });
    },
    { category: 'execute', riskLevel: 'low_risk', requiresApproval: true }
  );

  // 16. run_test
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'run_test',
        description: 'Run the project automated test suite and capture results.',
        parameters: {
          type: 'object',
          properties: {
            test_filter: { type: 'string', description: 'Optional test filter pattern' }
          },
          additionalProperties: false
        }
      }
    },
    async (args, execution) => {
      if (!vscode.workspace.isTrusted) throw new Error('Terminal execution is blocked because the workspace is not trusted.');
      const rootPath = getWorkspaceRootUri().fsPath;
      const filter = args.test_filter === undefined ? '' : getString(args.test_filter, 'test_filter', 300);
      if (filter && !/^[\w./:@ -]+$/.test(filter)) throw new Error('test_filter must be a plain test name or path, not shell syntax.');
      const cmd = filter ? `npm test -- "${filter}"` : 'npm test';
      if (context.terminalManager) {
        const process = await context.terminalManager.runCommand(cmd, rootPath, false, 60000, execution.signal);
        return {
          command: cmd,
          cwd: process.cwd,
          shell: process.shell,
          startedAt: process.startTime,
          durationMs: process.duration,
          processId: process.processId,
          passed: process.status === 'completed' && process.exitCode === 0,
          status: process.status,
          exitCode: process.exitCode ?? null,
          stdout: process.stdout.trim().slice(-10000),
          stderr: process.stderr.trim().slice(-5000)
        };
      }
      return new Promise((resolve) => {
        exec(cmd, { cwd: rootPath, timeout: 60000, maxBuffer: 1024 * 1024, signal: execution.signal }, (err, stdout, stderr) => {
          resolve({
            command: cmd,
            passed: !err,
            exitCode: err ? (err.code ?? 1) : 0,
            stdout: (stdout || '').trim().slice(-10000),
            stderr: (stderr || '').trim().slice(-5000)
          });
        });
      });
    },
    { category: 'execute', riskLevel: 'low_risk' }
  );

  // 17. get_diagnostics
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'get_diagnostics',
        description: 'Get active language diagnostics (compiler errors, lints) across workspace files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional relative path to filter diagnostics' }
          },
          additionalProperties: false
        }
      }
    },
    async (args) => {
      const targetPath = typeof args.path === 'string' ? args.path.trim() : undefined;
      const all = vscode.languages.getDiagnostics();
      const results: Array<{ file: string; line: number; severity: string; message: string }> = [];

      for (const [uri, diags] of all) {
        const rel = vscode.workspace.asRelativePath(uri);
        if (targetPath && rel !== targetPath) continue;
        for (const d of diags) {
          results.push({
            file: rel,
            line: d.range.start.line + 1,
            severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
            message: d.message
          });
        }
      }
      return { diagnostics: results.slice(0, 30) };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 18. get_editor_context
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'get_editor_context',
        description: 'Get the currently active editor file, cursor line, and active selection.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return { hasActiveEditor: false };
      if (!await canAttachWorkspaceContext(editor.document.uri)) throw new Error('The active editor is outside the authorized workspace context or contains a sensitive file. Use an explicitly approved file read instead.');
      return {
        hasActiveEditor: true,
        path: vscode.workspace.asRelativePath(editor.document.uri),
        languageId: editor.document.languageId,
        cursorLine: editor.selection.active.line + 1,
        selectedText: editor.document.getText(editor.selection).slice(0, 5000)
      };
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 19. inspect_project
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'inspect_project',
        description: 'Inspect package.json or project config to detect build scripts and project type.',
        parameters: { type: 'object', properties: {}, additionalProperties: false }
      }
    },
    async () => {
      const root = getWorkspaceRootUri();
      const pkgUri = vscode.Uri.joinPath(root, 'package.json');
      try {
        const bytes = await vscode.workspace.fs.readFile(pkgUri);
        const pkg = JSON.parse(new TextDecoder().decode(bytes));
        return {
          type: 'node',
          name: pkg.name,
          version: pkg.version,
          scripts: pkg.scripts,
          dependencies: Object.keys(pkg.dependencies || {}),
          devDependencies: Object.keys(pkg.devDependencies || {})
        };
      } catch {
        return { type: 'generic', message: 'No package.json found.' };
      }
    },
    { category: 'read', riskLevel: 'read_only' }
  );

  // 20. create_artifact
  registry.registerTool(
    {
      type: 'function',
      function: {
        name: 'create_artifact',
        description: 'Create a deliverable markdown artifact (plan, walkthrough, architecture report).',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Artifact title' },
            type: { type: 'string', description: 'Artifact type' },
            content: { type: 'string', description: 'Markdown content' }
          },
          required: ['title', 'content'],
          additionalProperties: false
        }
      }
    },
    async (args) => {
      const title = getString(args.title, 'title', 200);
      const type = typeof args.type === 'string' ? args.type : 'Report';
      const content = typeof args.content === 'string' ? args.content : '';

      if (context.artifactManager) {
        const art = context.artifactManager.createArtifact({
          title,
          type: type as any,
          content,
          conversationId: 'default'
        });
        return { success: true, artifactId: art.id, title: art.title };
      }
      return { success: true, title, message: 'Artifact created in memory.' };
    },
    { category: 'edit', riskLevel: 'low_risk' }
  );
}

function requireEditEngine(context: CoreToolContext): EditEngine {
  if (!context.editEngine) throw new Error('The reviewed edit engine is unavailable. No direct filesystem mutation was attempted.');
  return context.editEngine;
}

function getFileContent(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Tool argument ${name} must be a string (empty text is allowed).`);
  if (Buffer.byteLength(value, 'utf8') > maximumWriteBytes) throw new Error('File content exceeds the 512KB limit.');
  return value;
}

async function submitFileProposal(context: CoreToolContext, proposal: EditProposal, details: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (typeof context.autoApply === 'function' ? context.autoApply() : context.autoApply) {
    const result = await requireEditEngine(context).applyProposal(proposal.id, undefined, signal);
    return { ...details, success: result.success, applied: result.appliedCount > 0, proposalId: proposal.id, recoveryId: result.recoveryId, errors: result.errors };
  }
  return { ...details, success: true, proposed: true, proposalId: proposal.id, message: 'Awaiting review in Changes. No file operation has been applied.' };
}

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
  const root = roots[0];
  const uri = vscode.Uri.joinPath(root.uri, ...segments);

  if (vscode.workspace.getWorkspaceFolder && vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.uri.toString()) {
    throw new Error('The requested path is outside the selected workspace folder.');
  }

  if (uri.scheme === 'file') {
    await assertWorkspaceFilePath(root.uri.fsPath, uri.fsPath, allowNew);
  }

  return uri;
}

export function validateRelativeWorkspacePath(inputPath: string): string[] {
  return validateWorkspaceRelativePath(inputPath);
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
