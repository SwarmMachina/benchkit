import { performance } from 'node:perf_hooks'
import { quantileNearestRank } from '../statistics/quantile.js'
import { bytesToMiB } from '../units/bytes-to-mib.js'

export interface MeasureBatchOptions {
  operations: number
  run: () => readonly number[] | Promise<readonly number[]>
  before?: () => void | Promise<void>
}

export interface BatchLatencyMetrics {
  p50: number | null
  p95: number | null
  p99: number | null
}

export interface BatchMemoryDeltaMetrics {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

export interface BatchMeasurement {
  operations: number
  durationMs: number
  operationsPerSecond: number
  eluPct: number
  latencyMs: BatchLatencyMetrics
  memoryDeltaMiB: BatchMemoryDeltaMetrics
}

export default async function measureBatch({
  operations,
  run,
  before
}: MeasureBatchOptions): Promise<BatchMeasurement> {
  if (!Number.isSafeInteger(operations) || operations <= 0) {
    throw new TypeError('operations must be a positive safe integer')
  }

  await before?.()

  const memoryBefore = process.memoryUsage()
  const eluBefore = performance.eventLoopUtilization()
  const startedAt = performance.now()
  const samples = await run()
  const durationMs = performance.now() - startedAt
  const elu = performance.eventLoopUtilization(eluBefore)
  const memoryAfter = process.memoryUsage()

  return {
    operations,
    durationMs,
    operationsPerSecond: operations / (durationMs / 1000),
    eluPct: elu.utilization * 100,
    latencyMs: {
      p50: quantileNearestRank(samples, 0.5),
      p95: quantileNearestRank(samples, 0.95),
      p99: quantileNearestRank(samples, 0.99)
    },
    memoryDeltaMiB: {
      rss: bytesToMiB(memoryAfter.rss - memoryBefore.rss),
      heapTotal: bytesToMiB(memoryAfter.heapTotal - memoryBefore.heapTotal),
      heapUsed: bytesToMiB(memoryAfter.heapUsed - memoryBefore.heapUsed),
      external: bytesToMiB(memoryAfter.external - memoryBefore.external),
      arrayBuffers: bytesToMiB(memoryAfter.arrayBuffers - memoryBefore.arrayBuffers)
    }
  }
}
