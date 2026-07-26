import { performance } from 'node:perf_hooks'
import { requirePositiveInteger } from '../validation/value-parsers.js'
import { summarizeBoundedLatencySnapshot, type BoundedLatencySnapshot } from './bounded-latency-recorder.js'
import { ProcessMemorySampler, type ProcessMemorySummary } from './process-memory.js'
import { quantileNearestRank } from '../statistics/quantile.js'
import { bytesToMiB } from '../units/bytes-to-mib.js'

/** Exact latency samples or a mergeable bounded histogram accepted by `measureBatch`. */
export type BatchLatencyInput = readonly number[] | BoundedLatencySnapshot

/** Configuration for one batch measurement. */
export interface MeasureBatchOptions {
  /** Number of logical operations completed by `run`. */
  operations: number

  /** Executes the measured work and returns its latency observations. */
  run: () => BatchLatencyInput | Promise<BatchLatencyInput>

  /** Optional setup or stabilization hook excluded from measurement. */
  before?: () => void | Promise<void>

  /** Enables process-memory peak sampling at this interval, in milliseconds. */
  memorySampleMs?: number
}

/** Nearest-rank latency percentiles in milliseconds. */
export interface BatchLatencyMetrics {
  /** 50th percentile, or `null` when no finite samples were accepted. */
  p50: number | null

  /** 95th percentile, or `null` when no finite samples were accepted. */
  p95: number | null

  /** 99th percentile, or `null` when no finite samples were accepted. */
  p99: number | null
}

/** End-minus-start process memory deltas in mebibytes. */
export interface BatchMemoryDeltaMetrics {
  /** Resident set size delta. */
  rss: number

  /** V8 heap capacity delta. */
  heapTotal: number

  /** Used V8 heap delta. */
  heapUsed: number

  /** V8 external memory delta. */
  external: number

  /** `ArrayBuffer` memory delta. */
  arrayBuffers: number
}

/** Metadata describing batch latency calculation and input quality. */
export interface BatchLatencyDetails {
  /** Algorithm used to calculate reported percentiles. */
  algorithm: 'exact-nearest-rank' | 'logarithmic-histogram-nearest-rank'

  /** Number of accepted latency observations. */
  count: number

  /** Number of invalid or out-of-range observations excluded from percentiles. */
  dropped: number

  /** 97.5th percentile in milliseconds, or `null` when empty. */
  p97_5Ms: number | null

  /** Maximum relative percentile value error, expressed as a percentage. */
  maxRelativeErrorPct: number
}

/** Throughput, latency, event-loop, and memory result for one measured batch. */
export interface BatchMeasurement {
  /** Declared number of completed logical operations. */
  operations: number

  /** Measured wall time in milliseconds. */
  durationMs: number

  /** Operations divided by measured wall time in seconds. */
  operationsPerSecond: number

  /** Event-loop utilization during measurement, expressed as a percentage. */
  eluPct: number

  /** Nearest-rank latency percentiles in milliseconds. */
  latencyMs: BatchLatencyMetrics

  /** Latency algorithm, accepted count, and error bounds. */
  latencyDetails: BatchLatencyDetails

  /** End-minus-start process memory deltas in mebibytes. */
  memoryDeltaMiB: BatchMemoryDeltaMetrics

  /** Start, end, peak, and delta bytes when `memorySampleMs` was provided. */
  processMemory?: ProcessMemorySummary
}

export default async function measureBatch({
  operations,
  run,
  before,
  memorySampleMs
}: MeasureBatchOptions): Promise<BatchMeasurement> {
  requirePositiveInteger(operations, 'operations')

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
