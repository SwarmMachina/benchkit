import os from 'node:os'
import { BoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import { Http1LoadCoordinator } from './http1-load-coordinator.js'
import type { Http1LoadPhaseResult, NormalizedHttp1LoadOptions } from './http1-load-context.js'
import { buildHttp1Request } from './request.js'
import type { Http1WorkerResult } from './worker-protocol.js'
import type { Http1LoadErrorMetrics, Http1LoadParameters, Http1LoadResult, RunHttp1LoadOptions } from './types.js'

const DEFAULT_CONNECTIONS = 10
const DEFAULT_PIPELINING = 1
const DEFAULT_DURATION_MS = 10_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_MEMORY_SAMPLE_MS = 50
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024
const SATURATED_ELU_PCT = 95

/**
 * Runs an HTTP/1.1 load scenario and resolves with bounded measurements.
 *
 * Workers and connections are created once. An optional warmup phase drains
 * outstanding responses and resets measurements without discarding socket or
 * JIT state. The target should run in a separate process or host when
 * generator CPU and memory must exclude target work.
 * @param options Target, concurrency, scheduling, and measurement options.
 * @returns Throughput, latency, status, error, transport, CPU, ELU, and memory
 * measurements.
 * @throws {TypeError} If an option has an invalid type or the URL is unsupported.
 * @throws {RangeError} If a numeric option is outside its supported range.
 * @example Closed-loop saturation:
 * ```ts
 * const result = await runHttp1Load({
 *   url: 'http://127.0.0.1:3000/',
 *   connections: 100,
 *   pipelining: 10,
 *   durationMs: 10_000
 * })
 * ```
 * @example Fixed aggregate rate:
 * ```ts
 * const result = await runHttp1Load({
 *   url: 'http://127.0.0.1:3000/',
 *   connections: 100,
 *   rate: 50_000,
 *   durationMs: 10_000
 * })
 * ```
 */
export default async function runHttp1Load(options: RunHttp1LoadOptions): Promise<Http1LoadResult> {
  const normalized = normalizeOptions(options)
  const phase = await new Http1LoadCoordinator(normalized).run()

  return aggregateResult(normalized.parameters, phase)
}

function normalizeOptions(options: RunHttp1LoadOptions): NormalizedHttp1LoadOptions {
  if (!options || typeof options !== 'object') {
    throw new TypeError('runHttp1Load options must be an object')
  }

  const url = toUrl(options.url)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('runHttp1Load URL must use http: or https:')
  }

  if (url.username || url.password) {
    throw new TypeError('URL credentials are not supported; use an Authorization header')
  }

  if (url.hash) {
    throw new TypeError('runHttp1Load URL must not contain a fragment')
  }

  const connections = positiveInteger(options.connections ?? DEFAULT_CONNECTIONS, 'connections')
  const pipelining = positiveInteger(options.pipelining ?? DEFAULT_PIPELINING, 'pipelining')
  const workers = positiveInteger(options.workers ?? Math.min(4, os.availableParallelism(), connections), 'workers')
  const rate = options.rate === undefined ? null : positiveNumber(options.rate, 'rate')

  if (workers > connections) {
    throw new RangeError('workers must not exceed connections')
  }

  if (options.correctCoordinatedOmission !== undefined && typeof options.correctCoordinatedOmission !== 'boolean') {
    throw new TypeError('correctCoordinatedOmission must be a boolean')
  }

  if (rate === null && options.correctCoordinatedOmission !== undefined) {
    throw new TypeError('correctCoordinatedOmission requires rate')
  }

  const durationMs = positiveNumber(options.durationMs ?? DEFAULT_DURATION_MS, 'durationMs')
  const warmupMs = nonNegativeNumber(options.warmupMs ?? 0, 'warmupMs')
  const timeoutMs = positiveNumber(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const startupTimeoutMs = positiveNumber(options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS, 'startupTimeoutMs')
  const memorySampleMs = positiveNumber(options.memorySampleMs ?? DEFAULT_MEMORY_SAMPLE_MS, 'memorySampleMs')
  const maxHeaderBytes = positiveInteger(options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES, 'maxHeaderBytes')

  if (options.method !== undefined && typeof options.method !== 'string') {
    throw new TypeError('method must be a string')
  }

  const method = (options.method ?? 'GET').toUpperCase()
  const name = options.name ?? `${method} ${url.pathname || '/'}`

  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('name must be a non-empty string')
  }

  if (options.socketPath !== undefined && (typeof options.socketPath !== 'string' || options.socketPath === '')) {
    throw new TypeError('socketPath must be a non-empty string')
  }

  validateTlsOptions(options.tls)

  const body = options.body === undefined ? undefined : toBody(options.body)
  const request = buildHttp1Request({
    url,
    method,
    headers: options.headers ?? {},
    body
  })
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  const parameters: Http1LoadParameters = {
    name,
    url: url.href,
    method,
    connections,
    pipelining,
    workers,
    mode: rate === null ? 'closed-loop' : 'fixed-rate',
    rate,
    correctCoordinatedOmission: rate === null ? false : (options.correctCoordinatedOmission ?? true),
    durationMs,
    warmupMs,
    timeoutMs
  }

  return {
    parameters,
    request,
    protocol: url.protocol,
    hostname: networkHostname(url),
    port,
    ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
    ...(options.tls === undefined ? {} : { tls: options.tls }),
    startupTimeoutMs,
    memorySampleMs,
    maxHeaderBytes,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  }
}

function aggregateResult(parameters: Http1LoadParameters, phase: Http1LoadPhaseResult): Http1LoadResult {
  const latency = new BoundedLatencyRecorder()
  const statusCodes: Record<string, number> = {}
  const errors: Http1LoadErrorMetrics = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    abortedRequests: 0,
    total: 0
  }

  let sent = 0
  let completed = 0
  let bytesWritten = 0
  let bytesRead = 0
  let non2xx = 0
  let socketWriteCalls = 0
  let backpressureEvents = 0
  let drainWaitMs = 0
  let inFlightAtStop = 0
  let rateDropped = 0
  let scheduleLagTotalMs = 0
  let maxScheduleLagMs = 0
  let scheduledRequests = 0

  for (const worker of phase.workers) {
    latency.merge(worker.latencySnapshot)
    sent += worker.sent
    completed += worker.completed
    bytesWritten += worker.bytesWritten
    bytesRead += worker.bytesRead
    non2xx += worker.non2xx
    errors.connection += worker.errors.connection
    errors.timeout += worker.errors.timeout
    errors.protocol += worker.errors.protocol
    errors.abortedRequests += worker.errors.abortedRequests
    socketWriteCalls += worker.socketWriteCalls
    backpressureEvents += worker.backpressureEvents
    drainWaitMs += worker.drainWaitMs
    inFlightAtStop += worker.inFlightAtStop
    rateDropped += worker.rateDropped
    scheduleLagTotalMs += worker.scheduleLagTotalMs
    maxScheduleLagMs = Math.max(maxScheduleLagMs, worker.maxScheduleLagMs)
    scheduledRequests += worker.scheduledRequests

    for (const [statusCode, count] of Object.entries(worker.statusCodes)) {
      statusCodes[statusCode] = (statusCodes[statusCode] ?? 0) + count
    }
  }

  errors.total = errors.connection + errors.timeout + errors.protocol + errors.abortedRequests

  const workerElu = phase.workers.map((worker) => worker.eluPct)
  const maxWorkerEluPct = Math.max(...workerElu)
  const snapshot = latency.snapshot()

  return {
    parameters,
    startedAt: phase.startedAt.toISOString(),
    finishedAt: phase.finishedAt.toISOString(),
    durationMs: phase.durationMs,
    requests: {
      sent,
      completed,
      averagePerSecond: completed / (phase.durationMs / 1000),
      bytesWritten,
      bytesRead
    },
    latencyMs: latency.summary(),
    latencySnapshot: snapshot,
    statusCodes,
    non2xx,
    errors,
    transport: {
      socketWriteCalls,
      requestsPerSocketWrite: socketWriteCalls > 0 ? sent / socketWriteCalls : null,
      backpressureEvents,
      drainWaitMs,
      inFlightAtStop,
      rateDropped,
      meanScheduleLagMs: scheduledRequests > 0 ? scheduleLagTotalMs / scheduledRequests : null,
      maxScheduleLagMs
    },
    loadGenerator: {
      cpuMs: phase.cpuMs,
      cpuCorePct: phase.durationMs > 0 ? (phase.cpuMs / phase.durationMs) * 100 : 0,
      cpuPerMillionRequestsMs: completed > 0 ? (phase.cpuMs / completed) * 1_000_000 : null,
      parentEluPct: phase.parentEluPct,
      maxWorkerEluPct,
      meanWorkerEluPct: workerElu.reduce((total, value) => total + value, 0) / workerElu.length,
      workerHeapUsedPeakBytes: sumWorkerMetric(phase.workers, 'heapUsedPeakBytes'),
      workerExternalPeakBytes: sumWorkerMetric(phase.workers, 'externalPeakBytes'),
      workerArrayBuffersPeakBytes: sumWorkerMetric(phase.workers, 'arrayBuffersPeakBytes'),
      processMemory: phase.processMemory,
      saturated: maxWorkerEluPct >= SATURATED_ELU_PCT
    }
  }
}

function sumWorkerMetric(
  workers: readonly Http1WorkerResult[],
  key: 'heapUsedPeakBytes' | 'externalPeakBytes' | 'arrayBuffersPeakBytes'
): number {
  return workers.reduce((total, worker) => total + worker[key], 0)
}

function toUrl(value: string | URL): URL {
  if (value instanceof URL) {
    return new URL(value)
  }

  if (typeof value !== 'string' || value === '') {
    throw new TypeError('url must be a non-empty string or URL')
  }

  try {
    return new URL(value)
  } catch {
    throw new TypeError('url must be an absolute HTTP URL')
  }
}

function toBody(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return Buffer.from(value)
  }

  if (value instanceof Uint8Array) {
    return value
  }

  throw new TypeError('body must be a string or Uint8Array')
}

function networkHostname(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`)
  }

  return value
}

function positiveNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number`)
  }

  return value
}

function nonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }

  return value
}

function validateTlsOptions(options: RunHttp1LoadOptions['tls']): void {
  if (options === undefined) {
    return
  }

  if (!options || typeof options !== 'object') {
    throw new TypeError('tls must be an object')
  }

  if (options.rejectUnauthorized !== undefined && typeof options.rejectUnauthorized !== 'boolean') {
    throw new TypeError('tls.rejectUnauthorized must be a boolean')
  }

  if (options.servername !== undefined && (typeof options.servername !== 'string' || options.servername === '')) {
    throw new TypeError('tls.servername must be a non-empty string')
  }
}
