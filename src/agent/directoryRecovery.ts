import type { AgentToolCallRecord } from './agentLoop';

function relativeDirectory(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || /[:\u0000-\u001f<>|&$`%;]/.test(value)) return undefined;
  const normalized = value.replace(/\\+/g, '/').replace(/\/+$/, '');
  if (normalized.startsWith('/') || normalized.split('/').some(segment => !segment || segment === '..' || segment === '.')) return undefined;
  return normalized;
}

export function mkdirTargets(command: unknown): string[] {
  if (typeof command !== 'string' || /[\r\n<>|;$`%]/.test(command)) return [];
  const targets: string[] = [];
  for (const segment of command.split('&&')) {
    const match = segment.trim().match(/^(?:mkdir|md)\s+(?:-p\s+)?(.+)$/i);
    if (!match || /&/.test(match[1])) return [];
    const words = match[1].match(/"[^"\r\n]+"|'[^'\r\n]+'|[^\s"']+/g);
    if (!words || words.join(' ').replace(/\s+/g, ' ') !== match[1].replace(/\s+/g, ' ')) return [];
    for (const word of words) {
      const path = relativeDirectory(word.replace(/^["']|["']$/g, ''));
      if (!path || path.startsWith('-')) return [];
      targets.push(path);
    }
  }
  return [...new Set(targets)];
}

export function resolvedDirectoryFailures(calls: AgentToolCallRecord[]): string[] {
  const failed: AgentToolCallRecord[] = [];
  const existing = new Set<string>();
  for (const call of calls) {
    if (['run_command', 'run_test', 'delete_file', 'move_file', 'rollback_changes', 'install_dependencies', 'install_packages', 'run_build', 'run_lint'].includes(call.name) && ['success', 'error'].includes(call.status)) existing.clear();
    if (call.status === 'error' && call.name === 'run_command' && /syntax|illegal option|invalid option|unrecognized option/i.test(call.error ?? '') && mkdirTargets(call.args.command).length) failed.push(call);
    if (call.status !== 'success') continue;
    const output = call.result as Record<string, unknown> | undefined;
    if (!output || output.duplicateSuppressed) continue;
    const targets = call.name === 'create_directory' && output.created === true ? [relativeDirectory(call.args.path)] : call.name === 'file_stat' && output.exists === true && typeof output.type === 'number' && (output.type & 2) !== 0 ? [relativeDirectory(call.args.path)] : [];
    for (const path of targets) if (path) existing.add(path);
  }
  return failed.filter(call => mkdirTargets(call.args.command).every(path => existing.has(path))).map(call => `run_command:${call.args.command}`);
}
