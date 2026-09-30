const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:xox[baprs]-)[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk_live|rk_live)_[A-Za-z0-9]{16,}\b/g,
  /\bya29\.[A-Za-z0-9._-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /\b(?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*([^\s'"]{6,})/gi,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi,
  /(^|\n)\s*[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*[^\n]+/gm
];

export function redactString(value: string): string {
  let output = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix) => {
      if (typeof prefix === 'string' && pattern.flags.includes('m')) {
        return prefix + '[REDACTED]';
      }
      return '[REDACTED]';
    });
  }
  return output;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /password|secret|token|api[-_]?key|private/i.test(key) ? '[REDACTED]' : redactUnknown(nested);
    }
    return out;
  }
  return value;
}
