import {
  AgentHandoff,
  AgentRole,
  CoderHandoff,
  PlannerHandoff,
  ReviewerHandoff,
  SecurityHandoff,
  TesterHandoff
} from './types';

export function isPlannerHandoff(data: unknown): data is PlannerHandoff {
  return Boolean(data && typeof data === 'object' && typeof (data as any).taskId === 'string' && Array.isArray((data as any).orderedSubtasks));
}

export function isCoderHandoff(data: unknown): data is CoderHandoff {
  return Boolean(data && typeof data === 'object' && typeof (data as any).taskId === 'string' && Array.isArray((data as any).changedFiles));
}

export function isTesterHandoff(data: unknown): data is TesterHandoff {
  return Boolean(data && typeof data === 'object' && typeof (data as any).taskId === 'string' && typeof (data as any).passed === 'boolean' && Array.isArray((data as any).failures));
}

export function isReviewerHandoff(data: unknown): data is ReviewerHandoff {
  return Boolean(data && typeof data === 'object' && typeof (data as any).taskId === 'string' && Array.isArray((data as any).findings) && typeof (data as any).approved === 'boolean');
}

export function isSecurityHandoff(data: unknown): data is SecurityHandoff {
  return Boolean(data && typeof data === 'object' && typeof (data as any).taskId === 'string' && Array.isArray((data as any).findings) && typeof (data as any).passed === 'boolean');
}

export function validateHandoff(type: AgentHandoff['type'], data: unknown): AgentHandoff | undefined {
  const ok =
    (type === 'planner' && isPlannerHandoff(data)) ||
    (type === 'coder' && isCoderHandoff(data)) ||
    (type === 'tester' && isTesterHandoff(data)) ||
    (type === 'reviewer' && isReviewerHandoff(data)) ||
    (type === 'security' && isSecurityHandoff(data));
  return ok ? ({ type, data } as AgentHandoff) : undefined;
}

export function roleToHandoffType(role: AgentRole): AgentHandoff['type'] {
  switch (role) {
    case 'planner': return 'planner';
    case 'coder': return 'coder';
    case 'test_engineer':
    case 'debugger': return 'tester';
    case 'security_reviewer': return 'security';
    case 'reviewer': return 'reviewer';
    default: return 'generic';
  }
}
