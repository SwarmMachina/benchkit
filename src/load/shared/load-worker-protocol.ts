import type { BoundedLatencySnapshot } from '../../measurement/bounded-latency-recorder.js'

export interface LoadWorkerData {
  connections: number
  ratePerSecond?: number
  rateSequenceOffset: number
  rateSequenceStride: number
  correctCoordinatedOmission: boolean
  timeoutMs: number
  memorySampleMs: number
}

export interface LoadWorkerErrorMetrics {
  connection: number
  timeout: number
  protocol: number
  aborted: number
}

export interface LoadWorkerResult {
  durationMs: number
  sent: number
  completed: number
  bytesSent: number
  bytesReceived: number
  errors: LoadWorkerErrorMetrics
  latencySnapshot: BoundedLatencySnapshot
  sendCalls: number
  backpressureEvents: number
  backpressureWaitMs: number
  bufferedAmountPeakBytes: number
  inFlightAtStop: number
  rateDropped: number
  scheduleLagTotalMs: number
  maxScheduleLagMs: number
  scheduledOperations: number
  eluPct: number
  heapUsedPeakBytes: number
  externalPeakBytes: number
  arrayBuffersPeakBytes: number
}

export type LoadWorkerMessage<Result extends LoadWorkerResult> =
  | { type: 'ready' }
  | { type: 'warmup-complete' }
  | { type: 'result'; result: Result }
  | { type: 'fatal'; error: string }

export type LoadWorkerCommand =
  { type: 'start'; phase: 'warmup' | 'measurement'; durationMs: number } | { type: 'abort' }
