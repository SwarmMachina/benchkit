import { performance } from 'node:perf_hooks'

/** Result and elapsed wall time returned by `timed`. */
export interface TimedResult<T> {
  /** Value returned by the measured operation. */
  result: T

  /** Elapsed wall time in milliseconds. */
  ms: number
}

interface TimedThrown {
  _timedMs?: number
}

/**
 * Measures the wall time required for an operation to settle.
 * @param fn Synchronous or asynchronous operation to invoke once.
 * @returns The operation result and elapsed milliseconds.
 * @throws {unknown} The original operation error after attaching `_timedMs`.
 */
export default async function timed<T>(fn: () => T | Promise<T>): Promise<TimedResult<T>> {
  const t0 = performance.now()

  try {
    const r = await fn()
    const t1 = performance.now()

    return { result: r, ms: t1 - t0 }
  } catch (e) {
    const t1 = performance.now()

    ;(e as TimedThrown)._timedMs = t1 - t0
    throw e
  }
}
