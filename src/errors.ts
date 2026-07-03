/**
 * ZilMate Error Classification System
 */

export enum ErrorCategory {
  AUTH = 'AUTH',
  CONFIG = 'CONFIG',
  NETWORK = 'NETWORK',
  EXTERNAL_API = 'EXTERNAL_API',
  VALIDATION = 'VALIDATION',
  SECURITY = 'SECURITY',
  EXECUTION = 'EXECUTION',
  FILESYSTEM = 'FILESYSTEM',
  NOT_FOUND = 'NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorCode {
  MISSING_GATEWAY_KEY = 'MISSING_GATEWAY_KEY',
  INVALID_GATEWAY_KEY = 'INVALID_GATEWAY_KEY',
  MISSING_COMPOSIO_KEY = 'MISSING_COMPOSIO_KEY',
  MISSING_TAVILY_KEY = 'MISSING_TAVILY_KEY',
  MISSING_DEEPGRAM_KEY = 'MISSING_DEEPGRAM_KEY',
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_ENV_VAR = 'MISSING_ENV_VAR',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DNS_ERROR = 'DNS_ERROR',
  API_RATE_LIMITED = 'API_RATE_LIMITED',
  API_ERROR = 'API_ERROR',
  API_UNAUTHORIZED = 'API_UNAUTHORIZED',
  INVALID_INPUT = 'INVALID_INPUT',
  SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
  SHELL_COMMAND_REJECTED = 'SHELL_COMMAND_REJECTED',
  PATH_TRAVERSAL_DETECTED = 'PATH_TRAVERSAL_DETECTED',
  BLOCKED_FILE_ACCESS = 'BLOCKED_FILE_ACCESS',
  WEBHOOK_UNAUTHORIZED = 'WEBHOOK_UNAUTHORIZED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  COMMAND_FAILED = 'COMMAND_FAILED',
  COMMAND_TIMEOUT = 'COMMAND_TIMEOUT',
  PROCESS_SPAWN_ERROR = 'PROCESS_SPAWN_ERROR',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export class ZilMateError extends Error {
  public readonly code: ErrorCode;
  public readonly category: ErrorCategory;
  public readonly isOperational: boolean;
  public readonly context: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: ErrorCode = ErrorCode.UNKNOWN_ERROR,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    options?: {
      cause?: unknown;
      context?: Record<string, unknown>;
      isOperational?: boolean;
    },
  ) {
    super(message);
    if (options?.cause) {
      (this as any).cause = options.cause;
    }
    this.name = 'ZilMateError';
    this.code = code;
    this.category = category;
    this.isOperational = options?.isOperational ?? true;
    this.context = options?.context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZilMateError);
    }
  }

  toUserMessage(): string {
    switch (this.category) {
      case ErrorCategory.AUTH:
        return `Authentication error: ${this.message}. Run \`zilmate setup\` to configure credentials.`;
      case ErrorCategory.CONFIG:
        return `Configuration error: ${this.message}. Check your .env file or run \`zilmate doctor\`.`;
      case ErrorCategory.NETWORK:
        return `Network error: ${this.message}. Please check your internet connection and try again.`;
      case ErrorCategory.SECURITY:
        return `Security error: ${this.message}. This action has been blocked for safety.`;
      case ErrorCategory.VALIDATION:
        return `Invalid input: ${this.message}. Please check your input and try again.`;
      case ErrorCategory.EXECUTION:
        return `Execution failed: ${this.message}`;
      case ErrorCategory.EXTERNAL_API:
        return `External service error: ${this.message}. The service may be temporarily unavailable.`;
      case ErrorCategory.NOT_FOUND:
        return `Not found: ${this.message}`;
      default:
        return `An unexpected error occurred. Run \`zilmate doctor\` to diagnose, or try again later.`;
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      isOperational: this.isOperational,
      context: this.context,
      stack: this.stack,
    };
  }
}

export function normalizeError(error: unknown): ZilMateError {
  if (error instanceof ZilMateError) return error;

  if (error instanceof Error) {
    const msg = error.message;

    if (/AI_GATEWAY_API_KEY|AI Gateway auth|VERCEL_OIDC_TOKEN/.test(msg)) {
      return new ZilMateError(msg, ErrorCode.MISSING_GATEWAY_KEY, ErrorCategory.AUTH, { cause: error });
    }
    if (/COMPOSIO_API_KEY/.test(msg)) {
      return new ZilMateError(msg, ErrorCode.MISSING_COMPOSIO_KEY, ErrorCategory.AUTH, { cause: error });
    }
    if (/TAVILY_API_KEY/.test(msg)) {
      return new ZilMateError(msg, ErrorCode.MISSING_TAVILY_KEY, ErrorCategory.AUTH, { cause: error });
    }
    if (/DEEPGRAM_API_KEY/.test(msg)) {
      return new ZilMateError(msg, ErrorCode.MISSING_DEEPGRAM_KEY, ErrorCategory.AUTH, { cause: error });
    }
    if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(msg)) {
      return new ZilMateError(msg, ErrorCode.CONNECTION_FAILED, ErrorCategory.NETWORK, { cause: error });
    }
    if (/timeout/i.test(msg)) {
      return new ZilMateError(msg, ErrorCode.REQUEST_TIMEOUT, ErrorCategory.NETWORK, { cause: error });
    }
    if (/rate.limit|429/i.test(msg)) {
      return new ZilMateError(msg, ErrorCode.API_RATE_LIMITED, ErrorCategory.EXTERNAL_API, { cause: error });
    }
    if (/EACCES|EPERM|permission denied/i.test(msg)) {
      return new ZilMateError(msg, ErrorCode.PERMISSION_DENIED, ErrorCategory.FILESYSTEM, { cause: error });
    }
    if (/ENOENT|not found/i.test(msg)) {
      return new ZilMateError(msg, ErrorCode.FILE_NOT_FOUND, ErrorCategory.FILESYSTEM, { cause: error });
    }

    return new ZilMateError(msg, ErrorCode.UNKNOWN_ERROR, ErrorCategory.UNKNOWN, { cause: error, isOperational: false });
  }

  return new ZilMateError(String(error), ErrorCode.UNKNOWN_ERROR, ErrorCategory.UNKNOWN, { isOperational: false });
}

export function toFriendlyError(error: unknown): string {
  const classified = normalizeError(error);
  if (!classified.isOperational && process.env.NODE_ENV === 'production') {
    return classified.toUserMessage();
  }
  return classified.message;
}
