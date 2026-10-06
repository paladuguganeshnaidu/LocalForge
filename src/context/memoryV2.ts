export type MemoryTier =
  | 'task_working'
  | 'project_decisions'
  | 'user_preferences'
  | 'verified_facts';

export interface MemoryItem {
  id: string;
  tier: MemoryTier;
  key: string;
  value: string;
  confidence: number; // 0.0 to 1.0
  timestamp: number;
  ttlMs?: number;
  source?: string;
}

export interface MemoryContradiction {
  key: string;
  tier: MemoryTier;
  existingValue: string;
  newValue: string;
  resolution: 'superseded' | 'retained_existing';
}

export class MemoryManagerV2 {
  private readonly items = new Map<string, MemoryItem>();
  private readonly contradictions: MemoryContradiction[] = [];

  public set(
    tier: MemoryTier,
    key: string,
    value: string,
    confidence = 1.0,
    options?: { ttlMs?: number; source?: string }
  ): { item: MemoryItem; contradiction?: MemoryContradiction } {
    const id = `${tier}:${key.toLowerCase()}`;
    const existing = this.items.get(id);

    let contradiction: MemoryContradiction | undefined = undefined;

    if (existing && existing.value !== value) {
      if (confidence >= existing.confidence) {
        contradiction = {
          key,
          tier,
          existingValue: existing.value,
          newValue: value,
          resolution: 'superseded'
        };
        this.contradictions.push(contradiction);
      } else {
        contradiction = {
          key,
          tier,
          existingValue: existing.value,
          newValue: value,
          resolution: 'retained_existing'
        };
        this.contradictions.push(contradiction);
        return { item: existing, contradiction };
      }
    }

    const item: MemoryItem = {
      id,
      tier,
      key,
      value,
      confidence: Math.max(0, Math.min(1, confidence)),
      timestamp: Date.now(),
      ttlMs: options?.ttlMs,
      source: options?.source
    };

    this.items.set(id, item);
    return { item, contradiction };
  }

  public get(tier: MemoryTier, key: string): MemoryItem | undefined {
    const id = `${tier}:${key.toLowerCase()}`;
    const item = this.items.get(id);
    if (!item) return undefined;

    if (item.ttlMs && Date.now() - item.timestamp > item.ttlMs) {
      this.items.delete(id);
      return undefined;
    }

    return item;
  }

  public getByTier(tier: MemoryTier): MemoryItem[] {
    this.pruneExpired();
    return Array.from(this.items.values()).filter((item) => item.tier === tier);
  }

  public pruneExpired(): number {
    let pruned = 0;
    const now = Date.now();

    for (const [id, item] of this.items.entries()) {
      if (item.ttlMs && now - item.timestamp > item.ttlMs) {
        this.items.delete(id);
        pruned++;
      }
    }

    return pruned;
  }

  public purge(tier?: MemoryTier): void {
    if (!tier) {
      this.items.clear();
      return;
    }

    for (const [id, item] of this.items.entries()) {
      if (item.tier === tier) {
        this.items.delete(id);
      }
    }
  }

  public formatPrompt(): string {
    this.pruneExpired();

    const facts = this.getByTier('verified_facts');
    const decisions = this.getByTier('project_decisions');
    const preferences = this.getByTier('user_preferences');

    if (facts.length === 0 && decisions.length === 0 && preferences.length === 0) {
      return '';
    }

    const lines = ['=== DURABLE REPOSITORY MEMORY & PREFERENCES ==='];

    if (preferences.length > 0) {
      lines.push('User Preferences:');
      for (const p of preferences) {
        lines.push(`  - [${p.key}]: ${p.value}`);
      }
    }

    if (decisions.length > 0) {
      lines.push('Architectural Decisions:');
      for (const d of decisions) {
        lines.push(`  - [${d.key}]: ${d.value} (Confidence: ${(d.confidence * 100).toFixed(0)}%)`);
      }
    }

    if (facts.length > 0) {
      lines.push('Verified Facts:');
      for (const f of facts) {
        lines.push(`  - [${f.key}]: ${f.value}`);
      }
    }

    lines.push('===============================================');
    return lines.join('\n');
  }

  public export(): Record<string, unknown> {
    this.pruneExpired();
    return {
      items: Array.from(this.items.values()),
      contradictions: [...this.contradictions]
    };
  }
}
