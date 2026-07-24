/** JSON-safe error representation used by control transports. */
export interface SerializedError {
  /** Error class or display name. */
  name: string

  /** Human-readable error message. */
  message: string

  /** Stable machine-readable error code when available. */
  code?: string

  /** Original stack trace when available. */
  stack?: string

  /** Optional structured context supplied by the error producer. */
  details?: unknown
}

/** Base error for failures produced by Benchkit. */
export class BenchkitError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string

  /** Optional structured failure context. */
  readonly details?: unknown

  constructor(message: string, code = 'BENCHKIT_ERROR', details?: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

/** Indicates invalid user or environment configuration. */
export class ConfigurationError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', details, options)
  }
}

/** Indicates an attempted target lifecycle transition is not allowed. */
export class InvalidStateError extends BenchkitError {
  constructor(from: string, to: string, allowed: readonly string[]) {
    super(
      `Cannot transition target from "${from}" to "${to}"; allowed: ${allowed.join(', ') || 'none'}`,
      'INVALID_STATE',
      {
        from,
        to,
        allowed
      }
    )
  }
}

/** Indicates malformed, unsupported, or inconsistent control protocol data. */
export class ProtocolError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'PROTOCOL_ERROR', details, options)
  }
}

/** Indicates incompatible protocol or package versions. */
export class VersionMismatchError extends BenchkitError {
  constructor(kind: 'protocol' | 'package', expected: string | number, actual: string | number) {
    super(`${kind} version mismatch: expected ${expected}, received ${actual}`, 'VERSION_MISMATCH', {
      kind,
      expected,
      actual
    })
  }
}

/** Indicates an operation exceeded its explicit deadline. */
export class TimeoutError extends BenchkitError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', { operation, timeoutMs })
  }
}

/** Indicates an underlying local or SSH control transport failure. */
export class TransportError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'TRANSPORT_ERROR', details, options)
  }
}

/** Indicates a requested capability is unavailable for the selected mode. */
export class UnsupportedFeatureError extends BenchkitError {
  constructor(feature: string, mode: string) {
    super(`${feature} is not supported for target mode "${mode}"`, 'UNSUPPORTED_FEATURE', { feature, mode })
  }
}

/** Indicates a target reported ready but could not be reached over TCP. */
export class TargetUnreachableError extends BenchkitError {
  constructor(details: { bindHost: string; connectHost: string; port: number; lastNetworkError: string }) {
    super(
      `Target reported ready but ${details.connectHost}:${details.port} is unreachable; ` +
        'check the target listen address and firewall rules',
      'TARGET_UNREACHABLE',
      details
    )
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: unknown; details?: unknown }

    return {
      name: error.name,
      message: error.message,
      ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
      ...(error.stack ? { stack: error.stack } : {}),
      ...(candidate.details === undefined ? {} : { details: candidate.details })
    }
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : 'Unknown error',
    details: error
  }
}

export function errorFromSerialized(error: SerializedError): BenchkitError {
  return new BenchkitError(error.message, error.code ?? 'REMOTE_ERROR', error.details)
}
