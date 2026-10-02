import type { AgentState } from './agentLoop';

export function createRepositorySummaryFormatter(task: string): (response: string, state: AgentState) => string {
  return (response, state) => {
    if (!response.trim()) return response;
    if (!/\b(?:summary|summari[sz]e|purpose)\b/i.test(task)) return response;
    const record = state.steps.flatMap((step) => step.toolCalls).reverse().find((call) => call.status === 'success' && ['read_file', 'read_workspace_file'].includes(call.name) && call.args.path === 'package.json' && typeof (call.result as { content?: unknown } | undefined)?.content === 'string');
    const result = record?.result as { content?: unknown } | undefined;
    if (typeof result?.content !== 'string') return response;
    try {
      const manifest = JSON.parse(result.content);
      const name = manifest?.name;
      if (typeof name !== 'string' || name.length > 214 || !/^@?[\w.-]+(?:\/[\w.-]+)?$/.test(name) || response.includes(name)) return response;
      return `## Project: ${name}\nInspected source: \`package.json\`.\n\n${response}`;
    } catch { return response; }
  };
}

export function createRepositorySummaryValidator(task: string): (response: string, state: AgentState) => string | undefined {
  return (response, state) => {
    if (!/\b(?:summary|summari[sz]e|purpose)\b/i.test(task)) return;
    const records = state.steps.flatMap((step) => step.toolCalls);
    const inspected = records.reverse().find((call) => call.status === 'success' && ['read_file', 'read_workspace_file'].includes(call.name) && call.args.path === 'package.json' && typeof (call.result as { content?: unknown } | undefined)?.content === 'string');
    const result = inspected?.result as { content?: unknown } | undefined;
    if (typeof result?.content !== 'string') return;
    let manifest: { name?: unknown; displayName?: unknown; scripts?: Record<string, unknown> };
    try { manifest = JSON.parse(result.content); } catch { return; }
    if (!manifest || typeof manifest !== 'object') return;
    const exactName = /\bactual\s+name\b|package\.json\.name|\btechnical\s+name\b/i.test(task);
    const names = (exactName && typeof manifest.name === 'string' ? [manifest.name] : [manifest.name, manifest.displayName]).filter((value): value is string => typeof value === 'string' && value.length > 0);
    const issues: string[] = [];
    if (names.length && !names.some((name) => response.includes(name))) issues.push(`Include the actual project identity from the inspected package.json: ${JSON.stringify(names)}.`);
    for (const match of task.matchAll(/scripts\.([\w:-]+)/g)) {
      const command = manifest.scripts?.[match[1]];
      if (typeof command === 'string' && /\b(?:exact|copy)\b/i.test(task) && !response.includes(command)) issues.push(`Copy scripts.${match[1]} exactly: ${JSON.stringify(command)}.`);
    }
    return issues.length ? issues.join(' ') + ' Return the corrected concise Markdown summary, without guessing additional commands or features.' : undefined;
  };
}
