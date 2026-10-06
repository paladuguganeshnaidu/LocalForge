import { AgentRole } from './types';
import { TaskPriority } from './taskGraph';

export interface PlannedTaskNode {
  id: string;
  title: string;
  description: string;
  role: AgentRole;
  priority: TaskPriority;
  dependencies: string[];
  targetFiles: string[];
  acceptanceCriteria: string[];
  verificationStrategy: 'unit_test' | 'typecheck' | 'lint' | 'browser' | 'manual_review' | 'none';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface TaskGraphPlan {
  rationale: string;
  assumptions: string[];
  nodes: PlannedTaskNode[];
  globalAcceptanceCriteria: string[];
  verificationPlan: string[];
}

export const VALID_ROLES = new Set<AgentRole>([
  'orchestrator',
  'architect',
  'coder',
  'tester',
  'reviewer',
  'researcher',
  'debugger',
  'designer'
]);

export class PlanValidator {
  public static validate(plan: TaskGraphPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plan || typeof plan !== 'object') {
      return { valid: false, errors: ['Plan must be a non-null object.'] };
    }

    if (!Array.isArray(plan.nodes) || plan.nodes.length === 0) {
      errors.push('Plan must define at least one task node.');
      return { valid: false, errors };
    }

    if (plan.nodes.length > 30) {
      errors.push(`Plan exceeds maximum allowable nodes (limit: 30, provided: ${plan.nodes.length}).`);
    }

    const nodeIds = new Set<string>();

    for (const node of plan.nodes) {
      if (!node.id || typeof node.id !== 'string') {
        errors.push(`Task node missing valid "id".`);
      } else if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node id "${node.id}".`);
      } else {
        nodeIds.add(node.id);
      }

      if (!VALID_ROLES.has(node.role)) {
        errors.push(`Node "${node.id}" specifies invalid role "${node.role}".`);
      }

      if (!node.title || !node.description) {
        errors.push(`Node "${node.id}" must contain non-empty "title" and "description".`);
      }

      if (!Array.isArray(node.dependencies)) {
        errors.push(`Node "${node.id}" dependencies must be an array.`);
      }

      if (!Array.isArray(node.targetFiles)) {
        errors.push(`Node "${node.id}" targetFiles must be an array.`);
      }
    }

    // Check dependency existence and cycles
    for (const node of plan.nodes) {
      for (const depId of node.dependencies ?? []) {
        if (!nodeIds.has(depId)) {
          errors.push(`Node "${node.id}" references non-existent dependency "${depId}".`);
        }
        if (depId === node.id) {
          errors.push(`Node "${node.id}" cannot depend on itself.`);
        }
      }
    }

    // Cycle detection
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      inStack.add(nodeId);

      const node = plan.nodes.find((n) => n.id === nodeId);
      for (const depId of node?.dependencies ?? []) {
        if (!visited.has(depId)) {
          if (hasCycle(depId)) return true;
        } else if (inStack.has(depId)) {
          return true;
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const node of plan.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycle(node.id)) {
          errors.push('Cycle detected in planned task dependency graph.');
          break;
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
