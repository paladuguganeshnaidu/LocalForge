import type { AgentState, AgentToolCallRecord } from './agentLoop';
import { positiveTaskRequirements, requestedBrowserChecks } from './taskRequirements';

export interface VerificationAction {
  name: 'run_command' | 'process_status' | 'browser_action' | 'read_file';
  args: Record<string, unknown>;
  reason: string;
  key: string;
}

const editTools = new Set(['create_file', 'write_file', 'write_workspace_file', 'edit_workspace_file', 'replace_range']);
const verificationCommand = /^\s*(?:node\s+--test|(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:test|build|lint|typecheck)|(?:python(?:3)?|py(?:\s+-3)?)\s+-m\s+(?:unittest|pytest))(?=\s|$)/i;
const resultOf = (call: AgentToolCallRecord): Record<string, unknown> => call.result && typeof call.result === 'object' && !Array.isArray(call.result) ? call.result as Record<string, unknown> : {};

function localhostUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.port) return undefined;
    return url.href;
  } catch { return undefined; }
}

function processUrl(record: Record<string, unknown>): string | undefined {
  if (record.status !== 'running') return undefined;
  const output = typeof record.stdout === 'string' ? record.stdout : '';
  for (const match of output.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+[^\s"'<>]*/g)) {
    const url = localhostUrl(match[0]);
    if (url) return url;
  }
  const command = typeof record.command === 'string' ? record.command : '';
  const python = /\b(?:python(?:3)?|py(?:\s+-3)?)\s+-m\s+http\.server\s+(\d+)\b.*--bind\s+(127\.0\.0\.1|localhost)(?=\s|$)/i.exec(command);
  if (python && Number(python[1]) >= 1024 && Number(python[1]) <= 65535) return `http://${python[2]}:${python[1]}/`;
  return undefined;
}

export function planVerificationRecovery(task: string, state: AgentState, allowed: Set<string>, attempted: Set<string>): VerificationAction | undefined {
  if (state.mode !== 'agent') return undefined;
  const calls = state.steps.flatMap(step => step.toolCalls);
  if (calls.some(call => call.status === 'blocked' || call.status === 'cancelled' || /permission|not approved|denied/i.test(call.error || '') || resultOf(call).requiresUserAction === true || resultOf(call).proposed === true)) return undefined;
  const writes = calls.filter(call => call.status === 'success' && editTools.has(call.name) && resultOf(call).applied === true);
  const lastWrite = writes.at(-1);
  const lastWriteIndex = lastWrite ? calls.indexOf(lastWrite) : -1;
  const fresh = calls.slice(lastWriteIndex + 1);
  const revision = writes.length;
  const choose = (name: VerificationAction['name'], args: Record<string, unknown>, reason: string): VerificationAction | undefined => {
    const key = `${revision}:${name}:${JSON.stringify(args)}`;
    return allowed.has(name) && !attempted.has(key) ? { name, args, reason, key } : undefined;
  };

  if (lastWrite) {
    const failure = calls.slice(0, lastWriteIndex).reverse().find(call => call.name === 'run_command' && call.status === 'error' && typeof resultOf(call).exitCode === 'number' && resultOf(call).exitCode !== 0 && typeof call.args.command === 'string');
    if (failure) {
      const command = String(failure.args.command);
      const completed = fresh.some(call => call.name === 'run_command' && call.args.command === command && call.status === 'success' && resultOf(call).exitCode === 0);
      const attempts = calls.filter(call => call.source === 'verification' && call.name === 'run_command' && call.args.command === command).length;
      if (!completed && attempts < 3 && verificationCommand.test(command) && !/[;&|<>\r\n]/.test(command)) {
        const action = choose('run_command', { command }, 'Rerun the previously executed verification command after the saved repair');
        if (action) return action;
      }
    }
    const requested = positiveTaskRequirements(task);
    if (/\bread\s+(?:the\s+)?(?:saved|created)\s+file\b/i.test(requested) && typeof lastWrite.args.path === 'string' && !fresh.some(call => ['read_file', 'read_workspace_file'].includes(call.name) && call.args.path === lastWrite.args.path && call.status === 'success')) {
      const action = choose('read_file', { path: lastWrite.args.path }, 'Read back the saved file as explicitly requested');
      if (action) return action;
    }
  }

  const checks = requestedBrowserChecks(task);
  if (!checks) return undefined;
  const started = calls.filter(call => call.name === 'start_dev_server' && call.status === 'success' && resultOf(call).status === 'running').at(-1);
  const processId = started && resultOf(started).id;
  if (typeof processId !== 'string') return undefined;
  if (calls.slice(calls.indexOf(started!) + 1).some(call => call.name === 'stop_process' && call.args.process_id === processId && call.status === 'success')) return undefined;
  const inspected = calls.filter(call => call.name === 'process_status' && call.status === 'success' && Array.isArray(call.result)).reverse().flatMap(call => call.result as Record<string, unknown>[]).find(record => record.id === processId);
  if (!inspected) return choose('process_status', { process_id: processId }, 'Inspect the agent-owned server before browser verification');
  const url = processUrl(inspected);
  if (!url) return undefined;
  const origin = new URL(url).origin;
  const browserCalls = fresh.filter(call => call.name === 'browser_action' && call.status === 'success' && resultOf(call).rendered === true && localhostUrl(resultOf(call).url) && new URL(String(resultOf(call).url)).origin === origin);
  const rendered = browserCalls.find(call => call.args.action === 'render' && Number(resultOf(call).httpStatus) >= 200 && Number(resultOf(call).httpStatus) < 300);
  if (!rendered) return choose('browser_action', { action: 'render', url }, 'Render the actual agent-owned localhost server');
  for (const selector of checks.selectors) {
    if (!browserCalls.some(call => call.args.action === 'click' && call.args.selector === selector)) {
      const action = choose('browser_action', { action: 'click', selector }, `Check the explicitly requested interaction ${selector}`);
      if (action) return action;
    }
  }
  for (const width of checks.widths) {
    if (!browserCalls.some(call => (resultOf(call).viewport as { width?: number } | undefined)?.width === width)) {
      const action = choose('browser_action', { action: 'viewport', width, height: 900 }, `Check the requested layout at ${width}px`);
      if (action) return action;
    }
  }
  return undefined;
}
