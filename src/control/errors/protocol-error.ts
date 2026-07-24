import { BenchkitError } from './benchkit-error.js'

/** Indicates malformed, unsupported, or inconsistent control protocol data. */
export class ProtocolError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'PROTOCOL_ERROR', details, options)
  }
}
