import * as fs from 'fs';
import * as path from 'path';

export interface ScopedRule {
  id: string;
  source: string; // 'AGENTS.md' | '.tuxnest/rules/*.md' | 'security_policy'
  scope: string; // glob or '*'
  content: string;
  isMandatory: boolean;
  priority: number;
}

export class RulesEngine {
  private readonly rules: ScopedRule[] = [];

  constructor(private readonly workspaceRoot: string) {
    // Add default product security rule
    this.rules.push({
      id: 'core-security-policy',
      source: 'security_policy',
      scope: '*',
      content: 'Never bypass file boundary restrictions, execute destructive commands, or leak secrets.',
      isMandatory: true,
      priority: 0
    });
  }

  public async loadWorkspaceRules(): Promise<void> {
    // 1. Load AGENTS.md if present
    const agentsMdPath = path.join(this.workspaceRoot, 'AGENTS.md');
    if (fs.existsSync(agentsMdPath)) {
      try {
        const stats = await fs.promises.stat(agentsMdPath);
        if (stats.size < 100_000) {
          const content = await fs.promises.readFile(agentsMdPath, 'utf-8');
          this.rules.push({
            id: 'workspace-agents-md',
            source: 'AGENTS.md',
            scope: '*',
            content: content.trim(),
            isMandatory: false,
            priority: 10
          });
        }
      } catch {
        // Ignore read errors
      }
    }

    // 2. Load .tuxnest/rules/*.md
    const rulesDir = path.join(this.workspaceRoot, '.tuxnest', 'rules');
    if (fs.existsSync(rulesDir)) {
      try {
        const files = await fs.promises.readdir(rulesDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const filePath = path.join(rulesDir, file);
            const stats = await fs.promises.stat(filePath);
            if (stats.size < 50_000) {
              const content = await fs.promises.readFile(filePath, 'utf-8');
              const ruleId = `rule-${path.basename(file, '.md')}`;

              // Check if rule defines a scope header like `scope: src/**`
              let scope = '*';
              const match = content.match(/^scope:\s*(.+)$/m);
              if (match) {
                scope = match[1].trim();
              }

              this.rules.push({
                id: ruleId,
                source: `.tuxnest/rules/${file}`,
                scope,
                content: content.trim(),
                isMandatory: false,
                priority: 20
              });
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  public getRulesForFile(filePath?: string): ScopedRule[] {
    if (!filePath) {
      return this.rules.filter((r) => r.scope === '*');
    }

    const normPath = filePath.replace(/\\/g, '/');

    return this.rules.filter((rule) => {
      if (rule.scope === '*') return true;
      if (rule.scope.endsWith('/**')) {
        const prefix = rule.scope.slice(0, -3);
        return normPath.startsWith(prefix);
      }
      return normPath.includes(rule.scope);
    });
  }

  public formatRulesPrompt(targetFiles: string[] = []): string {
    const applicable = new Map<string, ScopedRule>();

    for (const rule of this.getRulesForFile()) {
      applicable.set(rule.id, rule);
    }

    for (const file of targetFiles) {
      for (const rule of this.getRulesForFile(file)) {
        applicable.set(rule.id, rule);
      }
    }

    const sortedRules = Array.from(applicable.values()).sort((a, b) => a.priority - b.priority);

    if (sortedRules.length === 0) return '';

    const sections = ['=== GOVERNANCE & PROJECT RULES ==='];
    for (const rule of sortedRules) {
      sections.push(`[Source: ${rule.source} | Scope: ${rule.scope}]\n${rule.content}`);
    }
    sections.push('==================================');

    return sections.join('\n\n');
  }

  public getAllRules(): readonly ScopedRule[] {
    return [...this.rules];
  }
}
