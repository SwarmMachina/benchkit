import { BenchkitError } from './benchkit-error.js'

/** Indicates an operation exceeded its explicit deadline. */
export class TimeoutError extends BenchkitError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', { operation, timeoutMs })
  }
}
