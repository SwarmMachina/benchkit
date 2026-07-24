import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { createBoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import { ProcessMemorySampler, type ProcessMemorySummary } from '../../measurement/process-memory.js'
import { buildHttp1Request } from './request.js'
import type { Http1WorkerCommand, Http1WorkerData, Http1WorkerMessage, Http1WorkerResult } from './worker-protocol.js'
import type { Http1LoadErrorMetrics, Http1LoadParameters, Http1LoadResult, RunHttp1LoadOptions } from './types.js'

const DEFAULT_CONNECTIONS = 10
const DEFAULT_PIPELINING = 1
const DEFAULT_DURATION_MS = 10_000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_MEMORY_SAMPLE_MS = 50
const DEFAULT_MAX_HEADER_BYTES = 64 * 1024
const SATURATED_ELU_PCT = 95

interface NormalizedHttp1LoadOptions {
  parameters: Http1LoadParameters
  request: Buffer
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  socketPath?: string
  tls?: RunHttp1LoadOptions['tls']
  startupTimeoutMs: number
  memorySampleMs: number
  maxHeaderBytes: number
  signal?: AbortSignal
}

interface PhaseResult {
  startedAt: Date
  finishedAt: Date
  durationMs: number
  workers: Http1WorkerResult[]
  cpuMs: number
  parentEluPct: number
  processMemory: ProcessMemorySummary
}

export default async function runHttp1Load(options: RunHttp1LoadOptions): Promise<Http1LoadResult> {
  const normalized = normalizeOptions(options)

  throwIfAborted(normalized.signal)

  const phase = await runLifecycle(normalized)

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

async function runLifecycle(options: NormalizedHttp1LoadOptions): Promise<PhaseResult> {
  throwIfAborted(options.signal)

  const workers = createWorkers(options)
  const memory = new ProcessMemorySampler()

  let memoryStarted = false

  try {
    await Promise.all(
      workers.map((worker) =>
        waitForWorkerMessage(worker, 'ready', options.startupTimeoutMs, options.signal, 'HTTP/1 worker startup')
      )
    )

    if (options.parameters.warmupMs > 0) {
      const warmupResults = workers.map((worker) =>
        waitForWorkerMessage(
          worker,
          'warmup-complete',
          options.parameters.warmupMs + options.parameters.timeoutMs + 5_000,
          options.signal,
          'HTTP/1 warmup'
        )
      )

      for (const worker of workers) {
        const command: Http1WorkerCommand = {
          type: 'start',
          phase: 'warmup',
          durationMs: options.parameters.warmupMs
        }

        worker.postMessage(command)
      }

      await Promise.all(warmupResults)
    }

    const results = workers.map((worker) =>
      waitForWorkerMessage(
        worker,
        'result',
        options.parameters.durationMs + options.parameters.timeoutMs + 5_000,
        options.signal,
        'HTTP/1 measurement'
      )
    )
    const startedAt = new Date()
    const eluBefore = performance.eventLoopUtilization()
    const cpuBefore = process.cpuUsage()

    memory.start({ sampleMs: options.memorySampleMs })
    memoryStarted = true

    for (const worker of workers) {
      const command: Http1WorkerCommand = {
        type: 'start',
        phase: 'measurement',
        durationMs: options.parameters.durationMs
      }

      worker.postMessage(command)
    }

    const messages = await Promise.all(results)
    const finishedAt = new Date()
    const elu = performance.eventLoopUtilization(eluBefore)
    const cpu = process.cpuUsage(cpuBefore)
    const processMemory = memory.stop()

    memoryStarted = false

    if (!processMemory) {
      throw new Error('HTTP/1 load process memory sampler did not produce a result')
    }

    const workerResults = messages.map((message) => {
      if (message.type !== 'result') {
        throw new Error('HTTP/1 worker returned an unexpected message')
      }

      return message.result
    })

    return {
      startedAt,
      finishedAt,
      durationMs: Math.max(...workerResults.map((result) => result.durationMs)),
      workers: workerResults,
      cpuMs: (cpu.user + cpu.system) / 1000,
      parentEluPct: elu.utilization * 100,
      processMemory
    }
  } finally {
    if (memoryStarted) {
      memory.stop()
    }

    await Promise.allSettled(workers.map((worker) => worker.terminate()))
  }
}

function createWorkers(options: NormalizedHttp1LoadOptions): Worker[] {
  const workers: Worker[] = []
  const baseConnections = Math.floor(options.parameters.connections / options.parameters.workers)
  const extraConnections = options.parameters.connections % options.parameters.workers

  for (let index = 0; index < options.parameters.workers; index++) {
    const workerConnections = baseConnections + (index < extraConnections ? 1 : 0)
    const data: Http1WorkerData = {
      request: options.request,
      protocol: options.protocol,
      hostname: options.hostname,
      port: options.port,
      method: options.parameters.method,
      connections: workerConnections,
      pipelining: options.parameters.pipelining,
      rateSequenceOffset: index,
      rateSequenceStride: options.parameters.workers,
      correctCoordinatedOmission: options.parameters.correctCoordinatedOmission,
      timeoutMs: options.parameters.timeoutMs,
      memorySampleMs: options.memorySampleMs,
      maxHeaderBytes: options.maxHeaderBytes,
      ...(options.parameters.rate === null ? {} : { ratePerSecond: options.parameters.rate }),
      ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
      ...(options.tls === undefined ? {} : { tls: options.tls })
    }

    workers.push(new Worker(new URL('./worker.js', import.meta.url), { workerData: data }))
  }

  return workers
}

function aggregateResult(parameters: Http1LoadParameters, phase: PhaseResult): Http1LoadResult {
  const latency = createBoundedLatencyRecorder()
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

function waitForWorkerMessage<Type extends Http1WorkerMessage['type']>(
  worker: Worker,
  expectedType: Type,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  phase: string
): Promise<Extract<Http1WorkerMessage, { type: Type }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`${phase} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    const onMessage = (message: Http1WorkerMessage): void => {
      if (message.type === 'fatal') {
        cleanup()
        reject(new Error(`HTTP/1 worker failed: ${message.error}`))

        return
      }

      if (message.type === expectedType) {
        cleanup()
        resolve(message as Extract<Http1WorkerMessage, { type: Type }>)
      }
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const onExit = (code: number): void => {
      cleanup()
      reject(new Error(`HTTP/1 worker exited before ${expectedType} with code ${code}`))
    }
    const onAbort = (): void => {
      cleanup()
      reject(abortError())
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      signal?.removeEventListener('abort', onAbort)
    }

    worker.on('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function abortError(): Error {
  const error = new Error('HTTP/1 load was aborted')

  error.name = 'AbortError'

  return error
}
