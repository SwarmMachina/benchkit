import type { BoundedLatencySnapshot, BoundedLatencySummary } from '../../measurement/bounded-latency-recorder.js'
import { BoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import type { ProcessMemorySummary } from '../../measurement/process-memory.js'
import type { LoadPhaseResult } from './load-coordinator-context.js'
import type { LoadWorkerResult } from './load-worker-protocol.js'

const SATURATED_ELU_PCT = 95

export interface AggregatedLoadOperations {
  sent: number
  completed: number
  averagePerSecond: number
  bytesSent: number
  bytesReceived: number
}

export interface AggregatedLoadErrors {
  connection: number
  timeout: number
  protocol: number
  aborted: number
  total: number
}

export interface AggregatedLoadTransport {
  sendCalls: number
  backpressureEvents: number
  backpressureWaitMs: number
  bufferedAmountPeakBytes: number
  inFlightAtStop: number
  rateDropped: number
  meanScheduleLagMs: number | null
  maxScheduleLagMs: number
}

export interface AggregatedLoadGeneratorMetrics {
  cpuMs: number
  cpuCorePct: number
  parentEluPct: number
  maxWorkerEluPct: number
  meanWorkerEluPct: number
  workerHeapUsedPeakBytes: number
  workerExternalPeakBytes: number
  workerArrayBuffersPeakBytes: number
  processMemory: ProcessMemorySummary
  saturated: boolean
}

export interface AggregatedLoadPhase {
  startedAt: string
  finishedAt: string
  durationMs: number
  operations: AggregatedLoadOperations
  latencyMs: BoundedLatencySummary
  latencySnapshot: BoundedLatencySnapshot
  errors: AggregatedLoadErrors
  transport: AggregatedLoadTransport
  loadGenerator: AggregatedLoadGeneratorMetrics
}

export function aggregateLoadPhase<WorkerResult extends LoadWorkerResult>(
  phase: LoadPhaseResult<WorkerResult>
): AggregatedLoadPhase {
  const latency = new BoundedLatencyRecorder()
  const errors = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    aborted: 0
  }

  let sent = 0
  let completed = 0
  let bytesSent = 0
  let bytesReceived = 0
  let sendCalls = 0
  let backpressureEvents = 0
  let backpressureWaitMs = 0
  let bufferedAmountPeakBytes = 0
  let inFlightAtStop = 0
  let rateDropped = 0
  let scheduleLagTotalMs = 0
  let maxScheduleLagMs = 0
  let scheduledOperations = 0
  let workerEluTotalPct = 0
  let maxWorkerEluPct = 0
  let workerHeapUsedPeakBytes = 0
  let workerExternalPeakBytes = 0
  let workerArrayBuffersPeakBytes = 0

  for (const worker of phase.workers) {
    latency.merge(worker.latencySnapshot)
    sent += worker.sent
    completed += worker.completed
    bytesSent += worker.bytesSent
    bytesReceived += worker.bytesReceived
    errors.connection += worker.errors.connection
    errors.timeout += worker.errors.timeout
    errors.protocol += worker.errors.protocol
    errors.aborted += worker.errors.aborted
    sendCalls += worker.sendCalls
    backpressureEvents += worker.backpressureEvents
    backpressureWaitMs += worker.backpressureWaitMs
    bufferedAmountPeakBytes = Math.max(bufferedAmountPeakBytes, worker.bufferedAmountPeakBytes)
    inFlightAtStop += worker.inFlightAtStop
    rateDropped += worker.rateDropped
    scheduleLagTotalMs += worker.scheduleLagTotalMs
    maxScheduleLagMs = Math.max(maxScheduleLagMs, worker.maxScheduleLagMs)
    scheduledOperations += worker.scheduledOperations
    workerEluTotalPct += worker.eluPct
    maxWorkerEluPct = Math.max(maxWorkerEluPct, worker.eluPct)
    workerHeapUsedPeakBytes += worker.heapUsedPeakBytes
    workerExternalPeakBytes += worker.externalPeakBytes
    workerArrayBuffersPeakBytes += worker.arrayBuffersPeakBytes
  }

  return {
    startedAt: phase.startedAt.toISOString(),
    finishedAt: phase.finishedAt.toISOString(),
    durationMs: phase.durationMs,
    operations: {
      sent,
      completed,
      averagePerSecond: completed / (phase.durationMs / 1000),
      bytesSent,
      bytesReceived
    },
    latencyMs: latency.summary(),
    latencySnapshot: latency.snapshot(),
    errors: {
      ...errors,
      total: errors.connection + errors.timeout + errors.protocol + errors.aborted
    },
    transport: {
      sendCalls,
      backpressureEvents,
      backpressureWaitMs,
      bufferedAmountPeakBytes,
      inFlightAtStop,
      rateDropped,
      meanScheduleLagMs: scheduledOperations > 0 ? scheduleLagTotalMs / scheduledOperations : null,
      maxScheduleLagMs
    },
    loadGenerator: {
      cpuMs: phase.cpuMs,
      cpuCorePct: phase.durationMs > 0 ? (phase.cpuMs / phase.durationMs) * 100 : 0,
      parentEluPct: phase.parentEluPct,
      maxWorkerEluPct,
      meanWorkerEluPct: workerEluTotalPct / phase.workers.length,
      workerHeapUsedPeakBytes,
      workerExternalPeakBytes,
      workerArrayBuffersPeakBytes,
      processMemory: phase.processMemory,
      saturated: maxWorkerEluPct >= SATURATED_ELU_PCT
    }
  }
}
