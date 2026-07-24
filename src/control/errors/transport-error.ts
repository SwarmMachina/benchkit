import { BenchkitError } from './benchkit-error.js'

/** Indicates an underlying local or SSH control transport failure. */
export class TransportError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'TRANSPORT_ERROR', details, options)
  }
}
