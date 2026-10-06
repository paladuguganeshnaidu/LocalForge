export type ProviderErrorCode =
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'UNKNOWN';

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly isRetryable = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderGateway {
  public static normalizeError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    // Check status code on error object
    const status = (err as Record<string, unknown>)?.status ?? (err as Record<string, unknown>)?.statusCode;
    const statusCode = typeof status === 'number' ? status : undefined;

    if (statusCode === 401 || statusCode === 403 || lower.includes('unauthorized') || lower.includes('invalid api key')) {
      return new ProviderError('AUTH_FAILED', message, statusCode, false);
    }

    if (statusCode === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
      return new ProviderError('RATE_LIMITED', message, statusCode, true);
    }

    if (statusCode === 400 && (lower.includes('context length') || lower.includes('token limit') || lower.includes('maximum context'))) {
      return new ProviderError('CONTEXT_LENGTH_EXCEEDED', message, statusCode, false);
    }

    if (statusCode === 503 || statusCode === 502 || lower.includes('econnrefused') || lower.includes('service unavailable')) {
      return new ProviderError('SERVICE_UNAVAILABLE', message, statusCode, true);
    }

    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted')) {
      return new ProviderError('TIMEOUT', message, statusCode, true);
    }

    return new ProviderError('UNKNOWN', message, statusCode, false);
  }

  public static isRetryable(err: unknown): boolean {
    return this.normalizeError(err).isRetryable;
  }
}
