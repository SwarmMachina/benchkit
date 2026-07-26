import { BenchkitError } from './errors/benchkit-error.js'

export { BenchkitError } from './errors/benchkit-error.js'
export { ConfigurationError } from './errors/configuration-error.js'
export { InvalidStateError } from './errors/invalid-state-error.js'
export { ProtocolError } from './errors/protocol-error.js'
export { TargetUnreachableError } from './errors/target-unreachable-error.js'
export { TimeoutError } from './errors/timeout-error.js'
export { TransportError } from './errors/transport-error.js'
export { UnsupportedFeatureError } from './errors/unsupported-feature-error.js'
export { VersionMismatchError } from './errors/version-mismatch-error.js'

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

/**
 * Converts any thrown value into a JSON-safe control-protocol error.
 * @param error Value caught at a control boundary.
 * @returns A serializable error preserving supported code, stack, and details fields.
 */
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

/**
 * Reconstructs a local {@link BenchkitError} from remote error data.
 * @param error Serialized error received from a control transport.
 * @returns A local error with the remote message, code, and details.
 */
export function errorFromSerialized(error: SerializedError): BenchkitError {
  return new BenchkitError(error.message, error.code ?? 'REMOTE_ERROR', error.details)
}
