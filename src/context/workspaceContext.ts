import * as vscode from 'vscode';
import { scoreText, selectRelevantLines } from './relevance';
import { canAttachWorkspaceContext } from './accessBoundary';

export { scoreText, selectRelevantLines } from './relevance';

export interface ContextSnippet {
  uri: vscode.Uri;
  path: string;
  startLine: number;
  text: string;
  score: number;
}

export interface ContextOptions {
  maxFiles?: number;
  maxChars?: number;
  maxFileBytes?: number;
  maxCandidates?: number;
}

const excluded = '**/{.git,node_modules,dist,out,build,coverage,vendor,.venv}/**';

export async function findRelevantSnippets(
  query: string,
  options: ContextOptions = {},
  excludeUri?: vscode.Uri
): Promise<ContextSnippet[]> {
  if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return [];
  const maxFiles = options.maxFiles ?? 4;
  const maxChars = options.maxChars ?? 8000;
  const maxFileBytes = options.maxFileBytes ?? 192 * 1024;
  const candidates = await vscode.workspace.findFiles('**/*', excluded, options.maxCandidates ?? 250);
  const scored: ContextSnippet[] = [];

  for (const uri of candidates) {
    if (excludeUri && uri.toString() === excludeUri.toString()) continue;
    if (!await canAttachWorkspaceContext(uri)) continue;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxFileBytes) continue;
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.includes(0)) continue;
      const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const score = scoreText(query, vscode.workspace.asRelativePath(uri), content);
      if (score < 2) continue;
      const selected = selectRelevantLines(query, content);
      if (!selected.text) continue;
      scored.push({ uri, path: vscode.workspace.asRelativePath(uri), ...selected, score });
    } catch {
      continue;
    }
  }

  scored.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  let remaining = maxChars;
  const output: ContextSnippet[] = [];
  for (const item of scored.slice(0, maxFiles)) {
    if (remaining <= 0) break;
    const text = item.text.slice(0, remaining);
    if (!text.trim()) continue;
    output.push({ ...item, text });
    remaining -= text.length;
  }
  return output;
}
