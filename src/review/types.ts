export type FindingSeverity = 'info' | 'warning' | 'error' | 'critical';
export type FindingCategory = 'style' | 'correctness' | 'security' | 'performance' | 'architecture';

export interface ReviewFinding {
  id: string;
  filePath: string;
  lineNumber?: number;
  severity: FindingSeverity;
  category: FindingCategory;
  cwe?: string;
  title: string;
  description: string;
  suggestedFix?: string;
}

export interface ReviewSummary {
  totalFindings: number;
  bySeverity: Record<FindingSeverity, number>;
  findings: ReviewFinding[];
  passed: boolean;
}
