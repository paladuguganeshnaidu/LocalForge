import * as crypto from 'crypto';

export interface ScopedToken {
  token: string;
  jobId: string;
  permissions: Set<string>;
  createdAt: number;
  expiresAt: number;
  revoked: boolean;
}

export class ScopedVault {
  private readonly tokens = new Map<string, ScopedToken>();

  public issueToken(jobId: string, permissions: string[], ttlMs = 3600_000): string {
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const token = `tk_${rawSecret}`;

    const scoped: ScopedToken = {
      token,
      jobId,
      permissions: new Set(permissions),
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      revoked: false
    };

    this.tokens.set(token, scoped);
    return token;
  }

  public validate(token: string, requiredPermission: string): { valid: boolean; reason?: string } {
    const scoped = this.tokens.get(token);
    if (!scoped) {
      return { valid: false, reason: 'Invalid or unknown token.' };
    }

    if (scoped.revoked) {
      return { valid: false, reason: 'Token has been revoked.' };
    }

    if (Date.now() > scoped.expiresAt) {
      return { valid: false, reason: 'Token has expired.' };
    }

    if (!scoped.permissions.has(requiredPermission) && !scoped.permissions.has('*')) {
      return {
        valid: false,
        reason: `Token lacks required permission "${requiredPermission}".`
      };
    }

    return { valid: true };
  }

  public revokeJobTokens(jobId: string): number {
    let count = 0;
    for (const scoped of this.tokens.values()) {
      if (scoped.jobId === jobId && !scoped.revoked) {
        scoped.revoked = true;
        count++;
      }
    }
    return count;
  }

  public clear(): void {
    this.tokens.clear();
  }
}
