export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export type ActionCategory =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'browser'
  | 'mcp'
  | 'destructive';

export type ActionSource = 'builtin' | 'mcp' | 'plugin' | 'workflow';

export interface ActionPrincipal {
  role: string;
  agentId?: string;
  isAutonomous?: boolean;
}

export interface ActionRequest {
  id: string;
  principal: ActionPrincipal;
  toolName: string;
  category: ActionCategory;
  source: ActionSource;
  workspaceRoot: string;
  paths?: string[];
  command?: string;
  networkDestinations?: string[];
  environmentAccess?: string[];
  riskClass: RiskClass;
  args: Record<string, unknown>;
}

export type DecisionType = 'allow' | 'deny' | 'prompt';

export interface PolicyDecision {
  decision: DecisionType;
  reason: string;
  riskClass: RiskClass;
  policyOrigin: string;
  sanitizedCommand?: string;
  sanitizedArgs?: Record<string, unknown>;
}
