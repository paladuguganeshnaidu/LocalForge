export interface SecretFinding {
  type: string;
  preview: string;
  index: number;
}

interface SecretPattern {
  type: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    type: 'AWS_ACCESS_KEY',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g
  },
  {
    type: 'GITHUB_PAT',
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g
  },
  {
    type: 'OPENAI_API_KEY',
    regex: /\b(sk-[a-zA-Z0-9]{20,64})\b/g
  },
  {
    type: 'ANTHROPIC_API_KEY',
    regex: /\b(sk-ant-[a-zA-Z0-9_\-]{20,100})\b/g
  },
  {
    type: 'SLACK_TOKEN',
    regex: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*)\b/g
  },
  {
    type: 'PRIVATE_KEY',
    regex: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----/g
  },
  {
    type: 'GENERIC_BEARER_TOKEN',
    regex: /\bBearer\s+([a-zA-Z0-9_\-\.]{25,})\b/g
  },
  {
    type: 'HARDCODED_CREDENTIAL',
    regex: /(?:password|passwd|api_key|secret_key|client_secret|auth_token)\s*[:=]\s*['"]([a-zA-Z0-9_!@#$%^&*()\-+=]{8,})['"]/gi
  }
];

export class SecretClassifier {
  public static calculateEntropy(str: string): number {
    if (!str.length) return 0;
    const frequencies = new Map<string, number>();
    for (const ch of str) {
      frequencies.set(ch, (frequencies.get(ch) ?? 0) + 1);
    }
    let entropy = 0;
    for (const count of frequencies.values()) {
      const p = count / str.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  public static classify(text: string): { hasSecret: boolean; findings: SecretFinding[] } {
    const findings: SecretFinding[] = [];

    for (const { type, regex } of SECRET_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        const secretStr = match[1] ?? match[0];
        findings.push({
          type,
          preview: secretStr.length > 8 ? `${secretStr.substring(0, 4)}...${secretStr.substring(secretStr.length - 4)}` : '****',
          index: match.index
        });
      }
    }

    return {
      hasSecret: findings.length > 0,
      findings
    };
  }

  public static redact(text: string): string {
    let result = text;
    for (const { type, regex } of SECRET_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      result = result.replace(re, (match, captured) => {
        if (captured) {
          return match.replace(captured, `[REDACTED_SECRET:${type}]`);
        }
        return `[REDACTED_SECRET:${type}]`;
      });
    }
    return result;
  }
}
