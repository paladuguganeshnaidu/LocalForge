import { TaskGraph, TaskGraphNode, TaskPriority } from './taskGraph';
import { PlanValidator, TaskGraphPlan, PlannedTaskNode } from './planSchema';
import { AgentRole } from './types';

export class DynamicPlanner {
  public static planGoal(
    userGoal: string,
    workspaceContext?: { indexedFiles?: string[]; detectedTechnologies?: string[] }
  ): TaskGraphPlan {
    const goalLower = userGoal.toLowerCase();
    const detectedFiles = workspaceContext?.indexedFiles ?? [];

    const nodes: PlannedTaskNode[] = [];
    const assumptions: string[] = ['Workspace environment is initialized and dependencies are installed.'];
    const globalAcceptanceCriteria: string[] = [
      'Implemented changes compile without errors.',
      'All automated tests pass.',
      'No security boundaries are violated.'
    ];
    const verificationPlan: string[] = [
      'Run workspace test suite.',
      'Verify target file diffs.'
    ];

    // Node 1: Architecture & Design Assessment
    nodes.push({
      id: 'task-1-arch',
      title: 'Analyze Architecture & Specifications',
      description: `Investigate existing patterns and produce implementation architecture for: ${userGoal}`,
      role: 'architect',
      priority: 'high',
      dependencies: [],
      targetFiles: [],
      acceptanceCriteria: ['Architecture decisions and affected files identified.'],
      verificationStrategy: 'manual_review',
      riskLevel: 'low'
    });

    // Check if task involves multiple distinct domains (e.g. frontend + backend or docs + code)
    const isFullStack =
      (goalLower.includes('frontend') && goalLower.includes('backend')) ||
      (goalLower.includes('api') && goalLower.includes('ui')) ||
      (goalLower.includes('client') && goalLower.includes('server'));

    if (isFullStack) {
      // Parallel branches for frontend and backend
      nodes.push({
        id: 'task-2-backend',
        title: 'Implement Backend Services & APIs',
        description: `Implement required backend logic, schemas, and routes for: ${userGoal}`,
        role: 'coder',
        priority: 'high',
        dependencies: ['task-1-arch'],
        targetFiles: detectedFiles.filter((f) => f.includes('server') || f.includes('api') || f.includes('backend')),
        acceptanceCriteria: ['Backend endpoints and contracts implemented.'],
        verificationStrategy: 'typecheck',
        riskLevel: 'medium'
      });

      nodes.push({
        id: 'task-3-frontend',
        title: 'Implement Frontend UI & Client Components',
        description: `Implement UI views, styles, and state management for: ${userGoal}`,
        role: 'coder',
        priority: 'high',
        dependencies: ['task-1-arch'],
        targetFiles: detectedFiles.filter((f) => f.includes('ui') || f.includes('client') || f.includes('view')),
        acceptanceCriteria: ['Frontend views and user interactions implemented.'],
        verificationStrategy: 'typecheck',
        riskLevel: 'medium'
      });

      nodes.push({
        id: 'task-4-test',
        title: 'Verify Integration & Unit Tests',
        description: 'Implement and execute comprehensive unit and integration tests across full stack.',
        role: 'tester',
        priority: 'urgent',
        dependencies: ['task-2-backend', 'task-3-frontend'],
        targetFiles: detectedFiles.filter((f) => f.includes('test')),
        acceptanceCriteria: ['Full stack test coverage and 100% test pass rate.'],
        verificationStrategy: 'unit_test',
        riskLevel: 'low'
      });
    } else {
      // Standard feature workflow
      nodes.push({
        id: 'task-2-code',
        title: 'Implement Solution Code',
        description: `Implement required code changes and modifications for: ${userGoal}`,
        role: 'coder',
        priority: 'urgent',
        dependencies: ['task-1-arch'],
        targetFiles: detectedFiles.slice(0, 5),
        acceptanceCriteria: ['All specified functional requirements implemented.'],
        verificationStrategy: 'typecheck',
        riskLevel: 'medium'
      });

      nodes.push({
        id: 'task-3-test',
        title: 'Execute Verification & Regression Testing',
        description: 'Verify changes against test suites and check for edge-case regressions.',
        role: 'tester',
        priority: 'high',
        dependencies: ['task-2-code'],
        targetFiles: detectedFiles.filter((f) => f.includes('test')),
        acceptanceCriteria: ['All tests pass with zero regressions.'],
        verificationStrategy: 'unit_test',
        riskLevel: 'low'
      });
    }

    // Final Node: Code & Security Review
    const lastDep = isFullStack ? 'task-4-test' : 'task-3-test';
    nodes.push({
      id: 'task-final-review',
      title: 'Perform Quality, Style & Security Review',
      description: 'Audit diffs for security vulnerabilities, style compliance, and production readiness.',
      role: 'reviewer',
      priority: 'high',
      dependencies: [lastDep],
      targetFiles: [],
      acceptanceCriteria: ['No high/critical security findings and clean diff.'],
      verificationStrategy: 'manual_review',
      riskLevel: 'low'
    });

    const plan: TaskGraphPlan = {
      rationale: `Dynamic DAG decomposed for goal: "${userGoal}"`,
      assumptions,
      nodes,
      globalAcceptanceCriteria,
      verificationPlan
    };

    const validation = PlanValidator.validate(plan);
    if (!validation.valid) {
      throw new Error(`Generated plan failed validation: ${validation.errors.join('; ')}`);
    }

    return plan;
  }

  public static buildTaskGraph(plan: TaskGraphPlan): TaskGraph {
    const validation = PlanValidator.validate(plan);
    if (!validation.valid) {
      throw new Error(`Cannot build TaskGraph from invalid plan: ${validation.errors.join('; ')}`);
    }

    const graph = new TaskGraph();

    for (const node of plan.nodes) {
      graph.addNode({
        id: node.id,
        title: node.title,
        description: node.description,
        role: node.role,
        dependencies: [...node.dependencies],
        targetFiles: [...node.targetFiles],
        priority: node.priority,
        maxRetries: 2
      });
    }

    return graph;
  }

  public static replanForFailure(
    graph: TaskGraph,
    failedNodeId: string,
    errorReason: string
  ): { replanned: boolean; remediationNodeId?: string } {
    const failedNode = graph.getNode(failedNodeId);
    if (!failedNode) return { replanned: false };

    const remediationId = `remediation-${failedNodeId}-${Date.now().toString(36)}`;
    const repairNode: Omit<TaskGraphNode, 'status' | 'retries'> & { status?: TaskGraphNode['status'] } = {
      id: remediationId,
      title: `Diagnose & Repair Failure in ${failedNode.title}`,
      description: `Investigate root cause and apply remediation for: ${errorReason}`,
      role: 'debugger',
      priority: 'urgent',
      dependencies: [...failedNode.dependencies],
      targetFiles: [...failedNode.targetFiles],
      maxRetries: 2
    };

    graph.addNode(repairNode);

    // Rewire any nodes that were waiting on failedNodeId to wait on remediationId
    for (const node of graph.getAllNodes()) {
      if (node.id === remediationId) continue;
      const depIdx = node.dependencies.indexOf(failedNodeId);
      if (depIdx !== -1) {
        node.dependencies.splice(depIdx, 1);
        if (!node.dependencies.includes(remediationId)) {
          node.dependencies.push(remediationId);
        }
      }
    }

    return { replanned: true, remediationNodeId: remediationId };
  }
}
