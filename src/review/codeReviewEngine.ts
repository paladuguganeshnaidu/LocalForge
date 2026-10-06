import { ReviewFinding, ReviewSummary } from './types';

export class CodeReviewEngine {
  public static reviewFile(filePath: string, content: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // 1. Placeholder and TODO comments
      if (/\b(?:TODO|FIXME|HACK|XXX)\b/i.test(line)) {
        findings.push({
          id: `cr-todo-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'warning',
          category: 'correctness',
          title: 'Unresolved TODO/FIXME comment',
          description: `Line contains a placeholder or TODO comment: "${line.trim()}". Complete implementation before finalizing.`,
          suggestedFix: 'Implement the remaining logic or remove the stale comment.'
        });
      }

      // 2. Unchecked `any` in TypeScript
      if (/:\s*any\b/.test(line) && !line.includes('//') && (filePath.endsWith('.ts') || filePath.endsWith('.tsx'))) {
        findings.push({
          id: `cr-any-type-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'warning',
          category: 'style',
          title: 'Unconstrained `any` type usage',
          description: 'Using `any` disables TypeScript compiler type safety guarantees.',
          suggestedFix: 'Replace `any` with a specific interface, generic, or `unknown` with type narrowing.'
        });
      }
    }

    // 3. Swallowed errors / empty catch blocks (both single-line and multi-line with optional comments)
    const emptyCatchRegex = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/.*|\/\*[\s\S]*?\*\/)?\s*\}/g;
    let catchMatch: RegExpExecArray | null;
    while ((catchMatch = emptyCatchRegex.exec(content)) !== null) {
      const lineNum = content.slice(0, catchMatch.index).split('\n').length;
      findings.push({
        id: `cr-swallowed-err-${lineNum}`,
        filePath,
        lineNumber: lineNum,
        severity: 'error',
        category: 'correctness',
        title: 'Swallowed exception in empty catch block',
        description: 'Empty catch block suppresses errors silently, making failures impossible to diagnose.',
        suggestedFix: 'Handle the error, log structured diagnostics, or rethrow.'
      });
    }

    return findings;
  }

  public static summarize(findings: ReviewFinding[]): ReviewSummary {
    const bySeverity = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0
    };

    for (const f of findings) {
      bySeverity[f.severity]++;
    }

    const passed = bySeverity.error === 0 && bySeverity.critical === 0;

    return {
      totalFindings: findings.length,
      bySeverity,
      findings,
      passed
    };
  }
}
