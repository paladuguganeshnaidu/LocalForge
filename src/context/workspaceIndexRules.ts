import * as vscode from 'vscode';
import ignore from 'ignore';
import { Minimatch } from 'minimatch';
import { canAttachWorkspaceContext } from './accessBoundary';

export const workspaceIndexExclusions = '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/coverage/**,**/.vscode-test/**,**/*.min.js,**/*.map,**/*.{png,jpg,jpeg,gif,ico,svg,lock,vsix,zip,pdf},**/package-lock.json}';
const hardExclusions = new Minimatch(workspaceIndexExclusions, { dot: true, nocase: true });
interface DirectoryRules { root: string; directory: string; matcher: ReturnType<typeof ignore> }

export class WorkspaceIndexRules {
  private rules: DirectoryRules[] = [];
  private excludes = new Map<string, Array<{ matcher: Minimatch; when?: string }>>();

  async load(): Promise<void> {
    const rules: DirectoryRules[] = [];
    const excludes = new Map<string, Array<{ matcher: Minimatch; when?: string }>>();
    const folders = vscode.workspace.workspaceFolders ?? [];
    const controlFiles = new Map<string, vscode.Uri>();
    for (const folder of folders) {
      const patterns: Array<{ pattern: string; when?: string }> = [];
      for (const section of ['files', 'search']) {
        const configured = vscode.workspace.getConfiguration?.(section, folder.uri).get<Record<string, boolean | { when: string }>>('exclude', {}) ?? {};
        for (const [pattern, enabled] of Object.entries(configured)) if (enabled) patterns.push({ pattern, when: typeof enabled === 'object' ? enabled.when : undefined });
      }
      if (patterns.length > 2000 || patterns.some(({ pattern, when }) => pattern.length > 1024 || when !== undefined && (typeof when !== 'string' || when.length > 500 || /[\\/\0]/.test(when)))) throw new Error('Workspace exclude settings exceed the safe index-rule limit or use an unsupported sibling condition.');
      let expandedPatterns = 0;
      excludes.set(folder.uri.toString(), patterns.map(({ pattern, when }) => {
        const matcher = new Minimatch(pattern, { dot: true, nocase: process.platform === 'win32', nonegate: true, braceExpandMax: 129 });
        expandedPatterns += matcher.globSet.length;
        if (matcher.globSet.length > 128 || expandedPatterns > 4000) throw new Error('Workspace exclude settings exceed the safe brace-expansion limit. Rebuild was refused rather than indexing potentially excluded files.');
        return { matcher, when };
      }));
      for (const filename of ['.gitignore', '.ignore']) {
        const target = vscode.Uri.joinPath(folder.uri, filename);
        controlFiles.set(target.toString(), target);
      }
    }
    if (typeof vscode.workspace.findFiles === 'function') {
      const discovered = await vscode.workspace.findFiles('**/{.gitignore,.ignore}', workspaceIndexExclusions, 1001);
      if (discovered.length > 1000) throw new Error('Too many ignore-rule files to safely build the workspace index (limit 1000).');
      for (const target of discovered) controlFiles.set(target.toString(), target);
    }
    for (const target of [...controlFiles.values()].sort((left, right) => left.path.length - right.path.length || left.path.localeCompare(right.path))) {
      if (!await canAttachWorkspaceContext(target)) {
        try { await vscode.workspace.fs.stat(target); }
        catch (error) { if (['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code ?? '')) continue; throw error; }
        throw new Error('An ignore-rule file is outside the authorized workspace boundary. Rebuild was refused.');
      }
      const folder = vscode.workspace.getWorkspaceFolder(target)!;
      const relativePath = vscode.workspace.asRelativePath(target, false).replace(/\\/g, '/');
      const directory = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/') + 1) : '';
      try {
        const stat = await vscode.workspace.fs.stat(target);
        if (stat.type !== vscode.FileType.File || stat.size > 65536) throw new Error(`Ignore rules in ${relativePath} are not a bounded regular text file.`);
        const bytes = await vscode.workspace.fs.readFile(target);
        if (bytes.includes(0) || bytes.length > 65536) throw new Error(`Invalid ignore rules in ${relativePath}.`);
        rules.push({ root: folder.uri.toString(), directory, matcher: ignore().add(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) });
      } catch (error) {
        if (!['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code ?? '')) throw error;
      }
    }
    this.rules = rules;
    this.excludes = excludes;
  }

  async allows(uri: vscode.Uri): Promise<boolean> {
    if (!vscode.workspace.isTrusted || !await canAttachWorkspaceContext(uri)) return false;
    const root = vscode.workspace.getWorkspaceFolder(uri)!.uri.toString();
    const path = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    if (!path || !ignore.isPathValid(path) || hardExclusions.match(path) || /(?:^|\/)\.(?:gitignore|ignore)$/.test(path)) return false;
    for (const configured of this.excludes.get(root) ?? []) {
      if (!configured.matcher.match(path)) continue;
      if (!configured.when) return false;
      const filename = path.split('/').at(-1)!;
      const sibling = configured.when.replace(/\$\(basename\)/g, filename.replace(/\.[^.]*$/, ''));
      const parent = vscode.workspace.getWorkspaceFolder(uri)!.uri;
      const target = vscode.Uri.joinPath(parent, ...path.split('/').slice(0, -1), sibling);
      try { if ((await vscode.workspace.fs.stat(target)).type === vscode.FileType.File) return false; }
      catch (error) { if (!['ENOENT', 'FileNotFound'].includes((error as { code?: string }).code ?? '')) throw error; }
    }
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.root !== root || !path.startsWith(rule.directory)) continue;
      const relativePath = path.slice(rule.directory.length);
      const parents = relativePath.split('/').slice(0, -1);
      for (let depth = 1; depth <= parents.length; depth += 1) if (rule.matcher.ignores(parents.slice(0, depth).join('/') + '/')) return false;
      const result = rule.matcher.test(relativePath);
      if (result.ignored) ignored = true;
      if (result.unignored) ignored = false;
    }
    return !ignored;
  }
}
