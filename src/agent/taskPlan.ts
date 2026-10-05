import { ModelToolDefinition } from '../providers/modelProvider';

export interface TaskPlan {
  steps: Array<{ step: string; status: 'pending' | 'in_progress' | 'completed'; phase: 'planning' | 'designing' | 'implementing' | 'verifying' }>;
  modelReported: true;
}

export const taskPlanDefinition: ModelToolDefinition = { type: 'function', function: {
  name: 'update_plan', description: 'Publish or revise your concise task-specific plan. Choose the steps for this user request; do not use a fixed pipeline. This reports intentions, not proof of completed edits/tests. Continue with executable tools.',
  parameters: { type: 'object', properties: { steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { step: { type: 'string', minLength: 1, maxLength: 160 }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }, phase: { type: 'string', enum: ['planning', 'designing', 'implementing', 'verifying'] } }, required: ['step', 'status', 'phase'], additionalProperties: false } } }, required: ['steps'], additionalProperties: false }
} };

export function validateTaskPlan(args: Record<string, unknown>): TaskPlan {
  if (!Array.isArray(args.steps) || !args.steps.length || args.steps.length > 12) throw new Error('Provide 1–12 concise task-specific plan steps.');
  const steps = args.steps.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Each plan step must be an object.');
    const { step, status, phase } = value as Record<string, unknown>;
    if (typeof step !== 'string' || !step.trim() || step.length > 160 || /[\r\n\u0000]/.test(step) || !['pending', 'in_progress', 'completed'].includes(String(status)) || !['planning', 'designing', 'implementing', 'verifying'].includes(String(phase))) throw new Error('Use a short single-line step, a valid status and a valid phase.');
    return { step: step.trim(), status, phase } as TaskPlan['steps'][number];
  });
  if (steps.filter(step => step.status === 'in_progress').length > 1 || new Set(steps.map(step => step.step)).size !== steps.length) throw new Error('Use distinct steps and at most one step in progress.');
  return { steps, modelReported: true };
}

export function modelWorkLabel(plan?: TaskPlan, previous?: { category?: string; status?: string; applied?: boolean }): string {
  if (previous?.status === 'error' || previous?.status === 'blocked') return 'Planning recovery from the failed action';
  const current = plan?.steps.find(step => step.status === 'in_progress');
  if (!current) {
    if (previous?.category === 'Reading') return 'Reviewing inspected files';
    if (previous?.category === 'Searching') return 'Reviewing search and reference results';
    if (previous?.category === 'Editing') return previous.applied ? 'Reviewing saved changes' : 'Reviewing edit proposals';
    if (previous?.category === 'Running') return 'Checking command results';
    if (previous?.category === 'Browser') return 'Checking browser results';
    return 'Planning the next action';
  }
  const labels = { planning: 'Planning', designing: 'Designing', implementing: 'Preparing implementation', verifying: 'Planning verification' };
  return `${labels[current.phase]}: ${current.step} (model plan)`;
}
