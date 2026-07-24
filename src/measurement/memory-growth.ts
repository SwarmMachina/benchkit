import { setTimeout as delay } from 'node:timers/promises'

/** Garbage-collection stabilization options used by memory-growth measurements. */
export interface ForceGcOptions {
  /**
   * Collection and event-loop settle cycles.
   * @default `4`
   */
  cycles?: number

  /**
   * Delay after each collection cycle, in milliseconds.
   * @default `10`
   */
  settleMs?: number

  /**
   * Collection implementation.
   * @default `globalThis.gc`
   */
  collectGarbage?: () => void | Promise<void>
}

/** Start, end, and retained process-memory values for one category. */
export interface MemoryGrowthMetric {
  /** Bytes observed after warmup and initial garbage collection. */
  startBytes: number

  /** Bytes observed after measured work and final garbage collection. */
  endBytes: number

  /** `endBytes - startBytes`; negative values are preserved. */
  deltaBytes: number
}

/** Retained process-memory result for a completed growth measurement. */
export interface MemoryGrowthSummary {
  /** Number of unmeasured warmup iterations. */
  warmup: number

  /** Number of measured iterations. */
  iterations: number

  /** Resident set size values. */
  rss: MemoryGrowthMetric

  /** V8 heap capacity values. */
  heapTotal: MemoryGrowthMetric

  /** Used V8 heap values. */
  heapUsed: MemoryGrowthMetric

  /** V8 external memory values. */
  external: MemoryGrowthMetric

  /** `ArrayBuffer` memory values. */
  arrayBuffers: MemoryGrowthMetric
}

/** Configuration for retained process-memory growth measurement. */
export interface MeasureMemoryGrowthOptions {
  /** Number of measured invocations. */
  iterations: number

  /** Work executed for each warmup and measured iteration. */
  run: (iteration: number) => void | Promise<void>

  /**
   * Number of unmeasured invocations before the starting snapshot.
   * @default `0`
   */
  warmup?: number

  /** Garbage-collection stabilization options. */
  gc?: ForceGcOptions

  /**
   * Process-memory snapshot provider.
   * @default `process.memoryUsage`
   */
  memoryUsage?: () => NodeJS.MemoryUsage
}

type MemoryKey = Exclude<keyof MemoryGrowthSummary, 'warmup' | 'iterations'>

const MEMORY_KEYS: readonly MemoryKey[] = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']

export async function forceGc({
  cycles = 4,
  settleMs = 10,
  collectGarbage = globalThis.gc
}: ForceGcOptions = {}): Promise<void> {
  if (!Number.isSafeInteger(cycles) || cycles <= 0) {
    throw new TypeError('GC cycles must be a positive safe integer')
  }

  if (!Number.isFinite(settleMs) || settleMs < 0) {
    throw new TypeError('GC settleMs must be a non-negative finite number')
  }

  if (typeof collectGarbage !== 'function') {
    throw new Error('garbage collection requires node --expose-gc')
  }

  for (let index = 0; index < cycles; index++) {
    await collectGarbage()
    await new Promise<void>((resolve) => setImmediate(resolve))

    if (settleMs > 0) {
      await delay(settleMs)
    }
  }
}

export async function measureMemoryGrowth({
  iterations,
  run,
  warmup = 0,
  gc,
  memoryUsage = process.memoryUsage
}: MeasureMemoryGrowthOptions): Promise<MemoryGrowthSummary> {
  validateCount(iterations, 'iterations', false)
  validateCount(warmup, 'warmup', true)

  if (typeof run !== 'function') {
    throw new TypeError('run must be a function')
  }

  if (typeof memoryUsage !== 'function') {
    throw new TypeError('memoryUsage must be a function')
  }

  for (let index = 0; index < warmup; index++) {
    await run(index)
  }

  await forceGc(gc)
  const start = memoryUsage()

  for (let index = 0; index < iterations; index++) {
    await run(warmup + index)
  }

  await forceGc(gc)
  const end = memoryUsage()
  const metrics = Object.fromEntries(
    MEMORY_KEYS.map((key) => [
      key,
      {
        startBytes: start[key],
        endBytes: end[key],
        deltaBytes: end[key] - start[key]
      }
    ])
  ) as Pick<MemoryGrowthSummary, MemoryKey>

  return { warmup, iterations, ...metrics }
}

function validateCount(value: number, name: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new TypeError(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} safe integer`)
  }
}
