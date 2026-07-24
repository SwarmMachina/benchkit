import type { BoundedLatencySnapshot, BoundedLatencySummary } from '../../measurement/bounded-latency-recorder.js'
import type { ProcessMemorySummary } from '../../measurement/process-memory.js'

export type Http1HeaderValue = string | readonly string[]

export interface Http1TlsOptions {
  ca?: string | Buffer | readonly (string | Buffer)[]
  cert?: string | Buffer | readonly (string | Buffer)[]
  key?: string | Buffer | readonly (string | Buffer)[]
  rejectUnauthorized?: boolean
  servername?: string
}

export interface RunHttp1LoadOptions {
  url: string | URL
  name?: string
  method?: string
  headers?: Readonly<Record<string, Http1HeaderValue>>
  body?: string | Uint8Array
  connections?: number
  pipelining?: number
  workers?: number
  durationMs?: number
  warmupMs?: number
  timeoutMs?: number
  startupTimeoutMs?: number
  memorySampleMs?: number
  maxHeaderBytes?: number
  socketPath?: string
  tls?: Http1TlsOptions
  signal?: AbortSignal
}

export interface Http1LoadParameters {
  name: string
  url: string
  method: string
  connections: number
  pipelining: number
  workers: number
  durationMs: number
  warmupMs: number
  timeoutMs: number
}

export interface Http1LoadRequestMetrics {
  sent: number
  completed: number
  averagePerSecond: number
  bytesRead: number
}

export interface Http1LoadErrorMetrics {
  connection: number
  timeout: number
  protocol: number
  abortedRequests: number
  total: number
}

export interface Http1LoadGeneratorMetrics {
  parentEluPct: number
  maxWorkerEluPct: number
  meanWorkerEluPct: number
  workerHeapUsedPeakBytes: number
  workerExternalPeakBytes: number
  workerArrayBuffersPeakBytes: number
  processMemory: ProcessMemorySummary
  saturated: boolean
}

export interface Http1LoadResult {
  parameters: Http1LoadParameters
  startedAt: string
  finishedAt: string
  durationMs: number
  requests: Http1LoadRequestMetrics
  latencyMs: BoundedLatencySummary
  latencySnapshot: BoundedLatencySnapshot
  statusCodes: Record<string, number>
  non2xx: number
  errors: Http1LoadErrorMetrics
  loadGenerator: Http1LoadGeneratorMetrics
}
