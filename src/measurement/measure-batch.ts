import { performance } from 'node:perf_hooks'
import { summarizeBoundedLatencySnapshot, type BoundedLatencySnapshot } from './bounded-latency-recorder.js'
import { ProcessMemorySampler, type ProcessMemorySummary } from './process-memory.js'
import { quantileNearestRank } from '../statistics/quantile.js'
import { bytesToMiB } from '../units/bytes-to-mib.js'

export type BatchLatencyInput = readonly number[] | BoundedLatencySnapshot

export interface MeasureBatchOptions {
  operations: number
  run: () => BatchLatencyInput | Promise<BatchLatencyInput>
  before?: () => void | Promise<void>
  memorySampleMs?: number
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

export interface BatchLatencyDetails {
  algorithm: 'exact-nearest-rank' | 'logarithmic-histogram-nearest-rank'
  count: number
  dropped: number
  p97_5Ms: number | null
  maxRelativeErrorPct: number
}

export interface BatchMeasurement {
  operations: number
  durationMs: number
  operationsPerSecond: number
  eluPct: number
  latencyMs: BatchLatencyMetrics
  latencyDetails: BatchLatencyDetails
  memoryDeltaMiB: BatchMemoryDeltaMetrics
  processMemory?: ProcessMemorySummary
}

export default async function measureBatch({
  operations,
  run,
  before,
  memorySampleMs
}: MeasureBatchOptions): Promise<BatchMeasurement> {
  if (!Number.isSafeInteger(operations) || operations <= 0) {
    throw new TypeError('operations must be a positive safe integer')
  }

  await before?.()

  const memorySampler = memorySampleMs === undefined ? null : new ProcessMemorySampler()

  memorySampler?.start({ sampleMs: memorySampleMs })

  const memoryBefore = process.memoryUsage()
  const eluBefore = performance.eventLoopUtilization()
  const startedAt = performance.now()

  let latencyInput: BatchLatencyInput
  let durationMs: number
  let elu: ReturnType<typeof performance.eventLoopUtilization>
  let memoryAfter: ReturnType<typeof process.memoryUsage>
  let processMemory: ProcessMemorySummary | null

  try {
    latencyInput = await run()
    durationMs = performance.now() - startedAt
    elu = performance.eventLoopUtilization(eluBefore)
    memoryAfter = process.memoryUsage()
  } finally {
    processMemory = memorySampler?.stop() ?? null
  }

  const latency = summarizeLatency(latencyInput)

  return {
    operations,
    durationMs,
    operationsPerSecond: operations / (durationMs / 1000),
    eluPct: elu.utilization * 100,
    latencyMs: latency.metrics,
    latencyDetails: latency.details,
    memoryDeltaMiB: {
      rss: bytesToMiB(memoryAfter.rss - memoryBefore.rss),
      heapTotal: bytesToMiB(memoryAfter.heapTotal - memoryBefore.heapTotal),
      heapUsed: bytesToMiB(memoryAfter.heapUsed - memoryBefore.heapUsed),
      external: bytesToMiB(memoryAfter.external - memoryBefore.external),
      arrayBuffers: bytesToMiB(memoryAfter.arrayBuffers - memoryBefore.arrayBuffers)
    },
    ...(processMemory ? { processMemory } : {})
  }
}

function summarizeLatency(input: BatchLatencyInput): {
  metrics: BatchLatencyMetrics
  details: BatchLatencyDetails
} {
  if (Array.isArray(input)) {
    const finite = input.filter(Number.isFinite)

    return {
      metrics: {
        p50: quantileNearestRank(finite, 0.5),
        p95: quantileNearestRank(finite, 0.95),
        p99: quantileNearestRank(finite, 0.99)
      },
      details: {
        algorithm: 'exact-nearest-rank',
        count: finite.length,
        dropped: input.length - finite.length,
        p97_5Ms: quantileNearestRank(finite, 0.975),
        maxRelativeErrorPct: 0
      }
    }
  }

  const summary = summarizeBoundedLatencySnapshot(input as BoundedLatencySnapshot)

  return {
    metrics: {
      p50: summary.p50Ms,
      p95: summary.p95Ms,
      p99: summary.p99Ms
    },
    details: {
      algorithm: summary.accuracy.algorithm,
      count: summary.count,
      dropped: summary.dropped,
      p97_5Ms: summary.p97_5Ms,
      maxRelativeErrorPct: summary.accuracy.maxRelativeErrorPct
    }
  }
}
