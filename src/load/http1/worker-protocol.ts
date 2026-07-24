import type { BoundedLatencySnapshot } from '../../measurement/bounded-latency-recorder.js'
import type { Http1TlsOptions } from './types.js'

export interface Http1WorkerData {
  request: Uint8Array
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  socketPath?: string
  tls?: Http1TlsOptions
  method: string
  connections: number
  pipelining: number
  ratePerSecond?: number
  rateSequenceOffset: number
  rateSequenceStride: number
  correctCoordinatedOmission: boolean
  timeoutMs: number
  memorySampleMs: number
  maxHeaderBytes: number
}

export interface Http1WorkerErrorMetrics {
  connection: number
  timeout: number
  protocol: number
  abortedRequests: number
}

export interface Http1WorkerResult {
  durationMs: number
  sent: number
  completed: number
  bytesWritten: number
  bytesRead: number
  statusCodes: Record<string, number>
  non2xx: number
  errors: Http1WorkerErrorMetrics
  latencySnapshot: BoundedLatencySnapshot
  socketWriteCalls: number
  backpressureEvents: number
  drainWaitMs: number
  inFlightAtStop: number
  rateDropped: number
  scheduleLagTotalMs: number
  maxScheduleLagMs: number
  scheduledRequests: number
  eluPct: number
  heapUsedPeakBytes: number
  externalPeakBytes: number
  arrayBuffersPeakBytes: number
}

export type Http1WorkerMessage =
  | { type: 'ready' }
  | { type: 'warmup-complete' }
  | { type: 'result'; result: Http1WorkerResult }
  | { type: 'fatal'; error: string }

export type Http1WorkerCommand =
  { type: 'start'; phase: 'warmup' | 'measurement'; durationMs: number } | { type: 'abort' }
