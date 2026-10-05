import type { AgentToolCallRecord } from './agentLoop';
import { materializeFileContent } from './fileContent';

export function resolvedReplacedEditFailures(calls: AgentToolCallRecord[]): string[] {
  const read = calls.at(-1);
  if (!read || !['read_file', 'read_workspace_file'].includes(read.name) || read.status !== 'success' || typeof read.args.path !== 'string') return [];
  const result = read.result as { content?: unknown; truncated?: boolean; duplicateSuppressed?: boolean } | undefined;
  if (typeof result?.content !== 'string' || result.truncated || result.duplicateSuppressed) return [];
  const previous = calls.slice(0, -1);
  const mutationNames = new Set(['create_file', 'write_file', 'write_workspace_file', 'edit_workspace_file', 'replace_range', 'delete_file']);
  const write = previous.filter(call => call.args.path === read.args.path && mutationNames.has(call.name)).at(-1);
  if (!write || !['create_file', 'write_file', 'write_workspace_file'].includes(write.name) || write.status !== 'success' || (write.result as { applied?: boolean } | undefined)?.applied !== true) return [];
  try { if (materializeFileContent(write.args) !== result.content) return []; } catch { return []; }
  return previous.slice(0, previous.indexOf(write)).filter(call => call.name === 'edit_workspace_file' && call.args.path === read.args.path && call.status === 'error' && /^Target content was not found in /.test(call.error ?? '')).map(call => `edit_workspace_file:${String(call.args.path)}`);
}
