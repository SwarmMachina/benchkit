import { BenchkitError } from './benchkit-error.js'

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
