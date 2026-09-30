export type CommandRisk =
  | 'READ_ONLY'
  | 'LOW_RISK_WRITE'
  | 'HIGH_RISK_WRITE'
  | 'DESTRUCTIVE'
  | 'NETWORK'
  | 'PRIVILEGED'
  | 'PACKAGE_INSTALL'
  | 'PROCESS_CONTROL';

export interface CommandDecision {
  allowed: boolean;
  requiresApproval: boolean;
  risk: CommandRisk;
  normalized: string;
  reason?: string;
}

const CONTROL = /[\u0000\r\n]/;
const SHELL_META = /(?:&&|\|\||[;|<>]|\$\(|\b(?:bash|sh|zsh|cmd|powershell|pwsh)\s+(?:-c|\/c|-Command)\b)/i;
const DESTRUCTIVE = /(?:\bdel\s+.*[a-z]:\\|\brm\s+-rf\b|\bmkfs(?:\.|\b)|\bdd\s+if=|\bformat\s+[a-z]:|\bshutdown\b|\breboot\b|\btaskkill\b.*\s\/f\b|\bsc\s+delete\b|\breg\s+delete\b|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:)/i;
const PRIVILEGED = /(?:\bsudo\b|\bsu\b|\bdoas\b|\bchmod\s+777\b|\bchown\b)/i;
const NETWORK = /(?:\bcurl\b|\bwget\b|\bscp\b|\bssh\b|\bnc\b|\bnetcat\b)/i;
const PACKAGE = /(?:^|\s)(?:npm\s+(?:i|install|ci)|pnpm\s+(?:i|install)|yarn\s+(?:add|install)|pip\s+install|uv\s+pip\s+install|cargo\s+add)(?:\s|$)/i;
const PROCESS = /(?:\bkill\b|\bpkill\b|\btaskkill\b|\bStart-Process\b)/i;
const READ_ONLY = /^(?:git\s+(?:status|diff|log|show|branch|rev-parse)|(?:pwd|whoami|uname|ls|dir|type|cat|head|tail|find|rg|grep)|node\s+--version|npm\s+--version)$/i;
const SAFE_PREFIXES = [
  /^npm\s+(?:test|run\s+(?:test|build|lint|compile|package|check|typecheck))\b/i,
  /^node(?:js)?\s+[^|;&<>$\r\n]+$/i,
  /^(?:python|python3)\s+-m\s+(?:pytest|unittest)\b/i,
  /^pytest\b/i,
  /^go\s+(?:test|build|vet)\b/i,
  /^cargo\s+(?:test|check|build|clippy)\b/i,
  /^git\s+(?:status|diff|log|show|branch|rev-parse)\b/i,
  /^(?:rg|grep|find|ls|dir|cat|head|tail)\b/i
];

export function classifyCommand(command: string): CommandDecision {
  const normalized = String(command ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { allowed: false, requiresApproval: false, risk: 'DESTRUCTIVE', normalized, reason: 'Empty command.' };
  if (CONTROL.test(normalized)) return { allowed: false, requiresApproval: false, risk: 'DESTRUCTIVE', normalized, reason: 'Control characters are not allowed.' };
  if (DESTRUCTIVE.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'DESTRUCTIVE', normalized, reason: 'Potentially destructive command.' };
  if (PRIVILEGED.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'PRIVILEGED', normalized, reason: 'Privileged command requires explicit review.' };
  if (SHELL_META.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'HIGH_RISK_WRITE', normalized, reason: 'Shell chaining, substitution, redirection, or nested shell execution is blocked.' };
  if (NETWORK.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'NETWORK', normalized, reason: 'Network-capable command requires explicit approval.' };
  if (PACKAGE.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'PACKAGE_INSTALL', normalized, reason: 'Package installation requires explicit approval.' };
  if (PROCESS.test(normalized)) return { allowed: false, requiresApproval: true, risk: 'PROCESS_CONTROL', normalized, reason: 'Process-control command requires explicit approval.' };
  if (READ_ONLY.test(normalized)) return { allowed: true, requiresApproval: false, risk: 'READ_ONLY', normalized };
  if (SAFE_PREFIXES.some((re) => re.test(normalized))) return { allowed: true, requiresApproval: false, risk: 'LOW_RISK_WRITE', normalized };
  return { allowed: false, requiresApproval: true, risk: 'HIGH_RISK_WRITE', normalized, reason: 'Command is outside the default safe allow-list.' };
}

export function assertAllowedCommand(command: string): CommandDecision {
  const decision = classifyCommand(command);
  if (!decision.allowed) throw new Error(decision.reason || 'Command blocked by CommandPolicy.');
  return decision;
}

export function validateCommandForApproval(command: string): CommandDecision {
  return classifyCommand(command);
}
