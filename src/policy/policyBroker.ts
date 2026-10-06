import {
  ActionRequest,
  PolicyDecision,
  RiskClass
} from './types';
import { ShellParser } from './shellParser';
import { FilesystemDefense } from './filesystemDefense';
import { NetworkPolicy } from './networkPolicy';
import { SecretClassifier } from './secretClassifier';

export type PermissionLevel = 'allow_safe_auto' | 'request_review' | 'always_proceed' | 'always_ask';

export class PolicyBroker {
  private permissionLevel: PermissionLevel;
  private readonly sessionGrants = new Set<string>();

  constructor(permissionLevel: PermissionLevel = 'allow_safe_auto') {
    this.permissionLevel = permissionLevel;
  }

  public setPermissionLevel(level: PermissionLevel): void {
    this.permissionLevel = level;
    this.clearSessionGrants();
  }

  public getPermissionLevel(): PermissionLevel {
    return this.permissionLevel;
  }

  public grantSessionTool(toolName: string): void {
    this.sessionGrants.add(toolName);
  }

  public clearSessionGrants(): void {
    this.sessionGrants.clear();
  }

  public evaluate(request: ActionRequest): PolicyDecision {
    // 1. Filesystem safety validation
    if (request.paths && request.paths.length > 0) {
      for (const targetPath of request.paths) {
        const pathCheck = FilesystemDefense.validatePathSafety(targetPath, request.workspaceRoot);
        if (!pathCheck.safe) {
          return {
            decision: 'deny',
            reason: `Filesystem security policy violation: ${pathCheck.reason}`,
            riskClass: 'critical',
            policyOrigin: 'FilesystemDefense'
          };
        }
      }
    }

    // 2. Command safety validation
    if (request.command) {
      const parsedShell = ShellParser.parse(request.command);
      if (parsedShell.hasDestructiveSegment) {
        return {
          decision: 'deny',
          reason: `Blocked catastrophic command: ${parsedShell.destructiveReasons.join('; ')}`,
          riskClass: 'critical',
          policyOrigin: 'ShellParser'
        };
      }
    }

    // 3. Network destination validation
    if (request.networkDestinations && request.networkDestinations.length > 0) {
      for (const url of request.networkDestinations) {
        const netCheck = NetworkPolicy.validateUrl(url);
        if (!netCheck.safe) {
          return {
            decision: 'deny',
            reason: `Network security policy violation: ${netCheck.reason}`,
            riskClass: 'high',
            policyOrigin: 'NetworkPolicy'
          };
        }
      }
    }

    // 4. Secret check in args (if write or command)
    if (request.category === 'write' || request.category === 'execute') {
      const argsStr = JSON.stringify(request.args);
      const secretCheck = SecretClassifier.classify(argsStr);
      if (secretCheck.hasSecret) {
        // Redact args in request
        const sanitizedStr = SecretClassifier.redact(argsStr);
        request.args = JSON.parse(sanitizedStr);
      }
    }

    // 5. Evaluate based on Risk Class and Permission Level
    if (request.riskClass === 'critical') {
      return {
        decision: 'deny',
        reason: 'Critical risk actions are unconditionally blocked by policy.',
        riskClass: 'critical',
        policyOrigin: 'RiskLevelEnforcer'
      };
    }

    if (this.permissionLevel === 'always_ask') {
      return {
        decision: 'prompt',
        reason: 'Policy is configured to always prompt user for authorization.',
        riskClass: request.riskClass,
        policyOrigin: 'AlwaysAskPolicy'
      };
    }

    if (this.permissionLevel === 'always_proceed') {
      // In always_proceed, high-risk operations still require prompting for safety
      if (request.riskClass === 'high') {
        return {
          decision: 'prompt',
          reason: 'High-risk action requires user confirmation even in automatic mode.',
          riskClass: 'high',
          policyOrigin: 'HighRiskSafetyGate'
        };
      }
      return {
        decision: 'allow',
        reason: 'Action approved under always_proceed mode.',
        riskClass: request.riskClass,
        policyOrigin: 'AlwaysProceedPolicy'
      };
    }

    if (this.permissionLevel === 'allow_safe_auto') {
      if (request.category === 'read') {
        return {
          decision: 'allow',
          reason: 'Read-only operation permitted automatically.',
          riskClass: 'low',
          policyOrigin: 'SafeAutoPolicy'
        };
      }

      if (this.sessionGrants.has(request.toolName)) {
        return {
          decision: 'allow',
          reason: `Tool "${request.toolName}" was previously authorized for this session.`,
          riskClass: request.riskClass,
          policyOrigin: 'SessionGrant'
        };
      }

      return {
        decision: 'prompt',
        reason: `Mutating or execution tool "${request.toolName}" requires user authorization.`,
        riskClass: request.riskClass,
        policyOrigin: 'SafeAutoGate'
      };
    }

    // request_review mode
    if (request.category === 'read') {
      return {
        decision: 'allow',
        reason: 'Read operation permitted.',
        riskClass: 'low',
        policyOrigin: 'ReviewMode'
      };
    }

    return {
      decision: 'prompt',
      reason: 'User review requested before proceeding.',
      riskClass: request.riskClass,
      policyOrigin: 'ReviewMode'
    };
  }
}
