import { ReviewFinding } from './types';
import { SecretClassifier } from '../policy/secretClassifier';

export class SecurityReviewEngine {
  public static scanFile(filePath: string, content: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // 1. CWE-78: Command Injection via child_process.exec or eval
      if (/\b(?:child_process\.exec|execSync)\s*\(\s*`[^`]*\$\{/i.test(line)) {
        findings.push({
          id: `sec-cwe78-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'critical',
          category: 'security',
          cwe: 'CWE-78',
          title: 'Command Injection vulnerability via template string in exec()',
          description: 'Executing unescaped shell commands with string interpolation allows arbitrary command injection.',
          suggestedFix: 'Use execFile() with an array of arguments or sanitize inputs thoroughly.'
        });
      }

      // 2. CWE-22: Path Traversal
      if (/path\.join\s*\([^)]*\.\.\//.test(line) && !line.includes('tests/')) {
        findings.push({
          id: `sec-cwe22-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'error',
          category: 'security',
          cwe: 'CWE-22',
          title: 'Path Traversal via relative path traversal in path.join()',
          description: 'Constructing paths with "../" can escape workspace boundaries.',
          suggestedFix: 'Validate paths with FilesystemDefense or resolveWorkspaceRelativePath() before opening.'
        });
      }

      // 3. CWE-79: Cross-Site Scripting via innerHTML
      if (/\.innerHTML\s*=\s*[^"'][^;]*/.test(line)) {
        findings.push({
          id: `sec-cwe79-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'error',
          category: 'security',
          cwe: 'CWE-79',
          title: 'Cross-Site Scripting (XSS) via unencoded innerHTML assignment',
          description: 'Assigning unescaped dynamic content to innerHTML introduces DOM-based XSS vulnerabilities.',
          suggestedFix: 'Use textContent, createElement(), or sanitize HTML through a dedicated encoder.'
        });
      }

      // 4. CWE-89: SQL Injection via string interpolation
      if (/(?:SELECT|INSERT|UPDATE|DELETE)\s+.*?\$\{.*?\}/i.test(line)) {
        findings.push({
          id: `sec-cwe89-${lineNum}`,
          filePath,
          lineNumber: lineNum,
          severity: 'critical',
          category: 'security',
          cwe: 'CWE-89',
          title: 'SQL Injection via concatenated query string',
          description: 'Dynamically interpolating variables into SQL queries permits SQL injection.',
          suggestedFix: 'Use parameterized queries or prepared statements.'
        });
      }
    }

    // 5. CWE-798: Hardcoded Credentials / Secrets
    const secretScan = SecretClassifier.classify(content);
    for (const secret of secretScan.findings) {
      findings.push({
        id: `sec-cwe798-${secret.index}`,
        filePath,
        severity: 'critical',
        category: 'security',
        cwe: 'CWE-798',
        title: `Hardcoded Secret Detected (${secret.type})`,
        description: `Potential high-entropy secret or API credential found in file content: ${secret.preview}.`,
        suggestedFix: 'Extract secret to environment variables or VS Code SecretStorage.'
      });
    }

    return findings;
  }
}
