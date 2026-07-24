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
