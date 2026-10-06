import { ResourceLease } from './types';

export class ResourceLeaseManager {
  private readonly leases = new Map<string, ResourceLease>();
  private readonly keyIndex = new Map<string, string>(); // resourceType:resourceKey -> leaseId

  public async acquire(
    runId: string,
    resourceType: ResourceLease['resourceType'],
    resourceKey: string,
    releaseCallback: () => Promise<void> | void
  ): Promise<ResourceLease> {
    const compoundKey = `${resourceType}:${resourceKey}`;
    if (this.keyIndex.has(compoundKey)) {
      const existingId = this.keyIndex.get(compoundKey)!;
      throw new Error(`Resource conflict: "${compoundKey}" is already leased by lease ID "${existingId}".`);
    }

    const leaseId = `lease_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const lease: ResourceLease = {
      id: leaseId,
      runId,
      resourceType,
      resourceKey,
      acquiredAt: Date.now(),
      release: releaseCallback
    };

    this.leases.set(leaseId, lease);
    this.keyIndex.set(compoundKey, leaseId);
    return lease;
  }

  public isLeased(resourceType: ResourceLease['resourceType'], resourceKey: string): boolean {
    return this.keyIndex.has(`${resourceType}:${resourceKey}`);
  }

  public async release(leaseId: string): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease) return;

    try {
      await lease.release();
    } finally {
      this.leases.delete(leaseId);
      this.keyIndex.delete(`${lease.resourceType}:${lease.resourceKey}`);
    }
  }

  public async releaseAllForRun(runId: string): Promise<void> {
    const matchingLeases = Array.from(this.leases.values()).filter((l) => l.runId === runId);
    // Release in reverse order of acquisition (LIFO)
    matchingLeases.reverse();

    const errors: Error[] = [];
    for (const lease of matchingLeases) {
      try {
        await this.release(lease.id);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    if (errors.length > 0) {
      throw new Error(`Errors during resource lease cleanup: ${errors.map((e) => e.message).join('; ')}`);
    }
  }

  public async releaseAll(): Promise<void> {
    const allLeases = Array.from(this.leases.values());
    allLeases.reverse();

    for (const lease of allLeases) {
      try {
        await this.release(lease.id);
      } catch {
        // Continue cleaning up remaining leases
      }
    }
  }

  public getActiveLeases(): readonly ResourceLease[] {
    return Array.from(this.leases.values());
  }
}
