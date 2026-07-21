export interface TimedResult<T> {
  result: T
  ms: number
}

interface TimedThrown {
  _timedMs?: number
}

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
