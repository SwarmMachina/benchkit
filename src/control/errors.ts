export interface SerializedError {
  name: string
  message: string
  code?: string
  stack?: string
  details?: unknown
}

export class BenchkitError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(message: string, code = 'BENCHKIT_ERROR', details?: unknown, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

export class ConfigurationError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', details, options)
  }
}

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

export class ProtocolError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'PROTOCOL_ERROR', details, options)
  }
}

export class VersionMismatchError extends BenchkitError {
  constructor(kind: 'protocol' | 'package', expected: string | number, actual: string | number) {
    super(`${kind} version mismatch: expected ${expected}, received ${actual}`, 'VERSION_MISMATCH', {
      kind,
      expected,
      actual
    })
  }
}

export class TimeoutError extends BenchkitError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', { operation, timeoutMs })
  }
}

export class TransportError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'TRANSPORT_ERROR', details, options)
  }
}

export class UnsupportedFeatureError extends BenchkitError {
  constructor(feature: string, mode: string) {
    super(`${feature} is not supported for target mode "${mode}"`, 'UNSUPPORTED_FEATURE', { feature, mode })
  }
}

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
