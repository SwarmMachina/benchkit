import { setTimeout as delay } from 'node:timers/promises'

export interface ForceGcOptions {
  cycles?: number
  settleMs?: number
  collectGarbage?: () => void | Promise<void>
}

export interface MemoryGrowthMetric {
  startBytes: number
  endBytes: number
  deltaBytes: number
}

export interface MemoryGrowthSummary {
  warmup: number
  iterations: number
  rss: MemoryGrowthMetric
  heapTotal: MemoryGrowthMetric
  heapUsed: MemoryGrowthMetric
  external: MemoryGrowthMetric
  arrayBuffers: MemoryGrowthMetric
}

export interface MeasureMemoryGrowthOptions {
  iterations: number
  run: (iteration: number) => void | Promise<void>
  warmup?: number
  gc?: ForceGcOptions
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
