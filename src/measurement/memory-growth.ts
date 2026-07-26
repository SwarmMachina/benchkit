import { setTimeout as delay } from 'node:timers/promises'
import {
  requireNonNegativeInteger,
  requireNonNegativeNumber,
  requirePositiveInteger
} from '../validation/value-parsers.js'

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

/**
 * Runs bounded garbage-collection cycles and allows the event loop to settle.
 * @param options Collection count, settling delay, and optional collector implementation.
 * @param options.cycles Number of collection cycles.
 * @param options.settleMs Delay after each collection cycle.
 * @param options.collectGarbage Collector implementation, normally `globalThis.gc`.
 * @returns A Promise that resolves after every collection cycle completes.
 * @throws {Error} If no garbage collector is available; start Node.js with `--expose-gc`.
 */
export async function forceGc({
  cycles = 4,
  settleMs = 10,
  collectGarbage = globalThis.gc
}: ForceGcOptions = {}): Promise<void> {
  requirePositiveInteger(cycles, 'GC cycles')
  requireNonNegativeNumber(settleMs, 'GC settleMs')

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

/**
 * Measures retained process-memory growth around repeated operation runs.
 *
 * Warmup executions are excluded. Garbage collection runs immediately before
 * the start and end snapshots.
 * @param options Iteration counts, operation, garbage collection, and snapshot provider.
 * @param options.iterations Measured operation count.
 * @param options.run Operation invoked for warmup and measured iterations.
 * @param options.warmup Unmeasured warmup operation count.
 * @param options.gc Garbage-collection stabilization options.
 * @param options.memoryUsage Process-memory snapshot provider.
 * @returns Per-category start, end, and retained byte deltas.
 * @throws {TypeError} If counts or callbacks are invalid.
 */
export async function measureMemoryGrowth({
  iterations,
  run,
  warmup = 0,
  gc,
  memoryUsage = process.memoryUsage
}: MeasureMemoryGrowthOptions): Promise<MemoryGrowthSummary> {
  requirePositiveInteger(iterations, 'iterations')
  requireNonNegativeInteger(warmup, 'warmup')

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
