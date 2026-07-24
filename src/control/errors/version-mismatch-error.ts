import { BenchkitError } from './benchkit-error.js'

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
