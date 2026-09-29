export type ContextCategory =
  | 'system_prompt'
  | 'user_task'
  | 'active_file'
  | 'selection'
  | 'references'
  | 'diagnostics'
  | 'git_context'
  | 'open_tabs'
  | 'workspace_retrieval'
  | 'conversation_history'
  | 'tool_results';

export interface BudgetAllocation {
  category: ContextCategory;
  rawChars: number;
  allocatedChars: number;
  tokensUsed: number;
  wasTruncated: boolean;
  text: string;
}

export interface ContextBudgetSummary {
  maxTokens: number;
  tokensUsed: number;
  tokensRemaining: number;
  breakdown: Record<ContextCategory, number>;
  allocations: BudgetAllocation[];
}

export class ContextBudget {
  private readonly maxTokens: number;
  private tokensUsed = 0;
  private allocations: BudgetAllocation[] = [];
  private breakdown: Record<ContextCategory, number> = {
    system_prompt: 0,
    user_task: 0,
    active_file: 0,
    selection: 0,
    references: 0,
    diagnostics: 0,
    git_context: 0,
    open_tabs: 0,
    workspace_retrieval: 0,
    conversation_history: 0,
    tool_results: 0
  };

  constructor(maxTokens = 16000) {
    this.maxTokens = Math.max(1024, maxTokens);
  }

  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  public getMaxTokens(): number {
    return this.maxTokens;
  }

  public getTokensUsed(): number {
    return this.tokensUsed;
  }

  public getRemainingTokens(): number {
    return Math.max(0, this.maxTokens - this.tokensUsed);
  }

  public canAllocate(tokens: number): boolean {
    return this.tokensUsed + tokens <= this.maxTokens;
  }

  public allocate(
    category: ContextCategory,
    text: string,
    categoryCapTokens?: number
  ): BudgetAllocation {
    if (!text) {
      const emptyAlloc: BudgetAllocation = {
        category,
        rawChars: 0,
        allocatedChars: 0,
        tokensUsed: 0,
        wasTruncated: false,
        text: ''
      };
      this.allocations.push(emptyAlloc);
      return emptyAlloc;
    }

    const availableTokens = this.getRemainingTokens();
    const effectiveCap = categoryCapTokens
      ? Math.min(categoryCapTokens, availableTokens)
      : availableTokens;

    const maxAllowedChars = Math.max(0, effectiveCap * 4);
    const wasTruncated = text.length > maxAllowedChars;
    const allocatedText = wasTruncated ? text.slice(0, maxAllowedChars) : text;
    const tokens = ContextBudget.estimateTokens(allocatedText);

    this.tokensUsed += tokens;
    this.breakdown[category] = (this.breakdown[category] || 0) + tokens;

    const alloc: BudgetAllocation = {
      category,
      rawChars: text.length,
      allocatedChars: allocatedText.length,
      tokensUsed: tokens,
      wasTruncated,
      text: allocatedText
    };

    this.allocations.push(alloc);
    return alloc;
  }

  public getSummary(): ContextBudgetSummary {
    return {
      maxTokens: this.maxTokens,
      tokensUsed: this.tokensUsed,
      tokensRemaining: this.getRemainingTokens(),
      breakdown: { ...this.breakdown },
      allocations: [...this.allocations]
    };
  }

  public formatSummaryText(): string {
    const active = Object.entries(this.breakdown)
      .filter(([_, tokens]) => tokens > 0)
      .map(([cat, tokens]) => `${cat.replace(/_/g, ' ')}: ${tokens.toLocaleString()} tok`);

    return `${active.join(' | ')} (${this.tokensUsed.toLocaleString()} / ${this.maxTokens.toLocaleString()} tokens)`;
  }
}
