import { BenchkitError } from './benchkit-error.js'

/** Indicates invalid user or environment configuration. */
export class ConfigurationError extends BenchkitError {
  constructor(message: string, details?: unknown, options?: ErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', details, options)
  }
}
