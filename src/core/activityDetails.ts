const maximumInputLength = 4000;
const maximumOutputLength = 8000;
const sensitiveKey = /(?:password|secret|token|api[-_]?key|private[-_]?key|authorization|credential)/i;

export function formatCommandLabel(name: string, args: Record<string, unknown>): string {
  if (name === 'install_packages') {
    try { return redactText(packageInstallCommand(args)); } catch { return 'install_packages (invalid package arguments)'; }
  }
  if (name === 'start_dev_server') {
    try { return redactText(prepareDevelopmentServerCommand(args.command)); } catch {}
  }
  const command = typeof args.command === 'string' ? args.command : name === 'run_test'
    ? args.test_filter ? `npm test -- "${String(args.test_filter)}"` : 'npm test'
    : name === 'run_build' ? 'npm run build' : name === 'run_lint' ? 'npm run lint' : name === 'install_dependencies' ? args.locked ? 'npm ci' : 'npm install' : name;
  return redactText(command);
}

export function formatToolInput(name: string, args: Record<string, unknown>): string {
  const safeArgs = sanitizeValue(args) as Record<string, unknown>;
  const body = JSON.stringify(safeArgs, null, 2) ?? '{}';
  return truncate(`Tool: ${name}\n${body}`, maximumInputLength);
}

export function formatToolOutput(result: unknown, error?: string): string {
  if (error) return truncate(`Error\n${redactText(error)}${result === undefined ? '' : '\n\n' + formatToolOutput(result)}`, maximumOutputLength);
  if (result === undefined) return 'No output.';
  if (typeof result === 'string') return truncate(redactText(result), maximumOutputLength);
  if (!result || typeof result !== 'object') return truncate(String(result), maximumOutputLength);
  if (Array.isArray(result)) return truncate(`Result\n${JSON.stringify(sanitizeValue(result), null, 2)}${result.length > 50 ? `\n… showing 50 of ${result.length} entries …` : ''}`, maximumOutputLength);

  const record = result as Record<string, unknown>;
  if (record.modelReported === true && Array.isArray(record.steps)) {
    return truncate('Model-reported task plan — intentions, not execution proof\n' + record.steps.map(step => {
      const item = step as Record<string, unknown>;
      return `- ${String(item.status)} · ${String(item.phase)}: ${redactText(String(item.step))}`;
    }).join('\n'), maximumOutputLength);
  }
  const stdout = typeof record.stdout === 'string' ? record.stdout : undefined;
  const stderr = typeof record.stderr === 'string' ? record.stderr : undefined;
  const metadata = Object.fromEntries(Object.entries(record)
    .filter(([key]) => key !== 'stdout' && key !== 'stderr')
    .map(([key, value]) => [key, sanitizeValue(value, key)]));
  const sections = [`Result\n${JSON.stringify(metadata, null, 2) ?? '{}'}`];
  if (stdout) sections.push(`stdout\n${redactText(stdout).slice(-4000)}`);
  if (stderr) sections.push(`stderr\n${redactText(stderr).slice(-2000)}`);
  return truncate(sections.join('\n\n'), maximumOutputLength);
}

function sanitizeValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50)
      .map(([childKey, childValue]) => [childKey, sanitizeValue(childValue, childKey)]));
  }
  return value;
}

function redactText(value: string): string {
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
    .replace(/(--?(?:password|token|secret|api[-_]?key|authorization)(?:=|\s+))("[^"]*"|'[^']*'|[^\s]+)/gi, '$1[REDACTED]')
    .replace(/\b(password|secret|token|api[-_]?key|authorization)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]');
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n… output truncated …` : value;
}
import { prepareDevelopmentServerCommand } from '../terminal/developmentServerCommand';
import { packageInstallCommand } from '../agent/packageInstall';
