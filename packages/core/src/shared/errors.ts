import type { BridgeFault } from './types.js';

export interface BridgeErrorOptions {
  retryable?: boolean;
  recoverable?: boolean;
  hint?: string;
  diagnostics?: Record<string, unknown>;
  suggestedNextSteps?: string[];
  cause?: unknown;
}

export class BridgeError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly recoverable: boolean;
  public readonly hint?: string;
  public readonly diagnostics?: Record<string, unknown>;
  public readonly suggestedNextSteps?: string[];

  public constructor(code: string, message: string, options: BridgeErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.code = code;
    this.name = 'BridgeError';
    this.retryable = options.retryable ?? false;
    this.recoverable = options.recoverable ?? false;
    this.hint = options.hint;
    this.diagnostics = options.diagnostics;
    this.suggestedNextSteps = options.suggestedNextSteps;
  }

  public toFault(): BridgeFault {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      recoverable: this.recoverable,
      hint: this.hint,
      diagnostics: this.diagnostics,
      suggestedNextSteps: this.suggestedNextSteps,
    };
  }

  public static fromFault(fault: BridgeFault): BridgeError {
    return new BridgeError(fault.code, fault.message, {
      retryable: fault.retryable,
      recoverable: fault.recoverable,
      hint: fault.hint,
      diagnostics: fault.diagnostics,
      suggestedNextSteps: fault.suggestedNextSteps,
    });
  }
}

export function toBridgeFault(error: unknown, fallbackCode = 'UNKNOWN_ERROR'): BridgeFault {
  if (error instanceof BridgeError) {
    return error.toFault();
  }

  if (isBridgeFault(error)) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: fallbackCode,
    message,
    retryable: false,
    recoverable: false,
    diagnostics: error instanceof Error && error.stack ? { stack: error.stack } : undefined,
  };
}

export function isBridgeFault(value: unknown): value is BridgeFault {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const fault = value as Partial<BridgeFault>;
  return (
    typeof fault.code === 'string' &&
    typeof fault.message === 'string' &&
    typeof fault.retryable === 'boolean' &&
    typeof fault.recoverable === 'boolean'
  );
}

export function ensure(condition: unknown, code: string, message: string, options?: BridgeErrorOptions): asserts condition {
  if (!condition) {
    throw new BridgeError(code, message, options);
  }
}

