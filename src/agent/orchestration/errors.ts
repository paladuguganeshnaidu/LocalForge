export interface StructuredErrorOptions {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  recoverable?: boolean;
  retryable?: boolean;
  userMessage?: string;
  internalMessage?: string;
  cause?: Error;
}

export abstract class LocalForgeError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;
  public readonly recoverable: boolean;
  public readonly retryable: boolean;
  public readonly userMessage: string;
  public readonly internalMessage: string;

  constructor(options: StructuredErrorOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.details = options.details || {};
    this.recoverable = options.recoverable ?? false;
    this.retryable = options.retryable ?? false;
    this.userMessage = options.userMessage || options.message;
    this.internalMessage = options.internalMessage || options.message;
    if (options.cause) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      recoverable: this.recoverable,
      retryable: this.retryable,
      details: this.details
    };
  }
}

export class ModelError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'MODEL_ERROR' });
  }
}

export class ProviderError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'PROVIDER_ERROR' });
  }
}

export class ToolError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'TOOL_ERROR' });
  }
}

export class TerminalError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'TERMINAL_ERROR' });
  }
}

export class FileError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'FILE_ERROR' });
  }
}

export class PermissionError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'PERMISSION_ERROR' });
  }
}

export class ParseError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'PARSE_ERROR' });
  }
}

export class TimeoutError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'TIMEOUT_ERROR', retryable: true });
  }
}

export class CancellationError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'CANCELLATION_ERROR', recoverable: false, retryable: false });
  }
}

export class AgentError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'AGENT_ERROR' });
  }
}

export class WorkspaceError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'WORKSPACE_ERROR' });
  }
}

export class GitError extends LocalForgeError {
  constructor(options: Omit<StructuredErrorOptions, 'code'> & { code?: string }) {
    super({ ...options, code: options.code || 'GIT_ERROR' });
  }
}
