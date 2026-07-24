import net, { type Socket } from 'node:net'
import { performance } from 'node:perf_hooks'
import tls, { type TLSSocket } from 'node:tls'
import { parentPort, workerData } from 'node:worker_threads'
import { createBoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import { Http1ResponseParser } from './response-parser.js'
import type {
  Http1WorkerCommand,
  Http1WorkerData,
  Http1WorkerErrorMetrics,
  Http1WorkerMessage,
  Http1WorkerResult
} from './worker-protocol.js'

if (!parentPort) {
  throw new Error('HTTP/1 load worker must run in a worker thread')
}

const port = parentPort
const RATE_TICK_MS = 1
const MAX_BATCH_BYTES = 1024 * 1024

type WorkerPhase = 'idle' | 'warmup' | 'warmup-draining' | 'measurement' | 'finished'

async function runWorker(data: Http1WorkerData): Promise<void> {
  const request = Buffer.from(data.request)
  const requestBatch =
    request.length * data.pipelining <= MAX_BATCH_BYTES
      ? Buffer.concat(Array.from({ length: data.pipelining }, () => request))
      : null
  const latency = createBoundedLatencyRecorder()
  const statusCodeCounts = new Float64Array(600)
  const errors: Http1WorkerErrorMetrics = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    abortedRequests: 0
  }
  const connections: Http1Connection[] = []

  let connected = 0
  let readySent = false
  let phase: WorkerPhase = 'idle'
  let running = false
  let startedAt = 0
  let stopAt = 0
  let stopTimer: NodeJS.Timeout | null = null
  let rateTimer: NodeJS.Timeout | null = null
  let memoryTimer: NodeJS.Timeout | null = null
  let phaseScheduled = 0
  let nextRateConnection = 0
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
  let eluBefore: ReturnType<typeof performance.eventLoopUtilization> | null = null
  let heapUsedPeakBytes = 0
  let externalPeakBytes = 0
  let arrayBuffersPeakBytes = 0

  function isMeasurement(): boolean {
    return phase === 'measurement'
  }

  function isClosedLoop(): boolean {
    return data.ratePerSecond === undefined
  }

  function sampleMemory(): void {
    const memory = process.memoryUsage()

    heapUsedPeakBytes = Math.max(heapUsedPeakBytes, memory.heapUsed)
    externalPeakBytes = Math.max(externalPeakBytes, memory.external)
    arrayBuffersPeakBytes = Math.max(arrayBuffersPeakBytes, memory.arrayBuffers)
  }

  function resetMeasurement(): void {
    latency.reset()
    statusCodeCounts.fill(0)
    errors.connection = 0
    errors.timeout = 0
    errors.protocol = 0
    errors.abortedRequests = 0
    sent = 0
    completed = 0
    bytesWritten = 0
    bytesRead = 0
    non2xx = 0
    socketWriteCalls = 0
    backpressureEvents = 0
    drainWaitMs = 0
    inFlightAtStop = 0
    rateDropped = 0
    scheduleLagTotalMs = 0
    maxScheduleLagMs = 0
    scheduledRequests = 0
    heapUsedPeakBytes = 0
    externalPeakBytes = 0
    arrayBuffersPeakBytes = 0
  }

  function onConnected(connection: Http1Connection): void {
    connected++

    if (running && isClosedLoop()) {
      connection.fillPipeline()
    }

    if (!readySent && connected === data.connections) {
      readySent = true
      post({ type: 'ready' })
    }
  }

  function onDisconnected(): void {
    connected = Math.max(0, connected - 1)

    if (phase === 'warmup-draining') {
      maybeCompleteWarmup()
    }
  }

  function onResponse(connection: Http1Connection, statusCode: number): boolean {
    const sentAt = connection.timestamps.shift()

    if (sentAt === null) {
      if (isMeasurement()) {
        errors.protocol++
      }

      connection.reconnectAfterProtocolError()

      return false
    }

    const now = performance.now()

    if (isMeasurement()) {
      completed++
      statusCodeCounts[statusCode] = (statusCodeCounts[statusCode] ?? 0) + 1

      if (statusCode < 200 || statusCode >= 300) {
        non2xx++
      }

      latency.record(now - sentAt)
    }

    if (phase === 'warmup-draining') {
      maybeCompleteWarmup()
    }

    return isClosedLoop() && running && now < stopAt
  }

  function startPhase(command: Extract<Http1WorkerCommand, { type: 'start' }>): void {
    if (phase !== 'idle') {
      throw new Error(`cannot start HTTP/1 ${command.phase} phase while worker is ${phase}`)
    }

    if (command.phase === 'measurement') {
      for (const connection of connections) {
        connection.resetPhaseState()
      }

      resetMeasurement()
      phase = 'measurement'
      eluBefore = performance.eventLoopUtilization()
      sampleMemory()
      memoryTimer = setInterval(sampleMemory, data.memorySampleMs)
    } else {
      phase = 'warmup'
    }

    running = true
    startedAt = performance.now()
    stopAt = startedAt + command.durationMs
    phaseScheduled = 0
    nextRateConnection = 0

    if (isClosedLoop()) {
      for (const connection of connections) {
        connection.fillPipeline()
      }
    } else {
      rateTimer = setInterval(scheduleRate, RATE_TICK_MS)
    }

    stopTimer = setTimeout(endPhase, command.durationMs)
  }

  function endPhase(): void {
    if (phase !== 'warmup' && phase !== 'measurement') {
      return
    }

    running = false
    clearPhaseTimers()

    if (phase === 'warmup') {
      phase = 'warmup-draining'
      maybeCompleteWarmup()

      return
    }

    phase = 'finished'
    inFlightAtStop = totalInFlight()
    sampleMemory()

    for (const connection of connections) {
      connection.stop()
    }

    const durationMs = performance.now() - startedAt
    const elu = eluBefore ? performance.eventLoopUtilization(eluBefore) : { utilization: 0 }
    const result: Http1WorkerResult = {
      durationMs,
      sent,
      completed,
      bytesWritten,
      bytesRead,
      statusCodes: statusCodesResult(),
      non2xx,
      errors,
      latencySnapshot: latency.snapshot(),
      socketWriteCalls,
      backpressureEvents,
      drainWaitMs,
      inFlightAtStop,
      rateDropped,
      scheduleLagTotalMs,
      maxScheduleLagMs,
      scheduledRequests,
      eluPct: elu.utilization * 100,
      heapUsedPeakBytes,
      externalPeakBytes,
      arrayBuffersPeakBytes
    }

    post({ type: 'result', result })
    port.close()
  }

  function maybeCompleteWarmup(): void {
    if (phase !== 'warmup-draining' || totalInFlight() !== 0) {
      return
    }

    for (const connection of connections) {
      connection.resetPhaseState()
    }

    phase = 'idle'
    post({ type: 'warmup-complete' })
  }

  function clearPhaseTimers(): void {
    if (stopTimer) {
      clearTimeout(stopTimer)
      stopTimer = null
    }

    if (rateTimer) {
      clearInterval(rateTimer)
      rateTimer = null
    }

    if (memoryTimer) {
      clearInterval(memoryTimer)
      memoryTimer = null
    }
  }

  function totalInFlight(): number {
    let total = 0

    for (const connection of connections) {
      total += connection.timestamps.size
    }

    return total
  }

  function scheduleRate(): void {
    const rate = data.ratePerSecond

    if (!running || rate === undefined) {
      return
    }

    const now = performance.now()
    const globalExpected = Math.floor(((Math.min(now, stopAt) - startedAt) * rate) / 1000)
    const expected =
      globalExpected <= data.rateSequenceOffset
        ? 0
        : Math.floor((globalExpected - 1 - data.rateSequenceOffset) / data.rateSequenceStride) + 1

    let due = expected - phaseScheduled

    while (due > 0) {
      const sequence = data.rateSequenceOffset + 1 + phaseScheduled * data.rateSequenceStride
      const scheduledAt = startedAt + (sequence * 1000) / rate
      const connection = nextAvailableRateConnection()

      phaseScheduled++
      due--

      if (connection) {
        connection.queueRateRequest(scheduledAt)
      } else {
        if (isMeasurement()) {
          rateDropped += due + 1
        }

        phaseScheduled += due
        due = 0
      }
    }

    for (const connection of connections) {
      connection.flushRateRequests()
    }
  }

  function nextAvailableRateConnection(): Http1Connection | null {
    for (let attempt = 0; attempt < connections.length; attempt++) {
      const index = nextRateConnection

      nextRateConnection = (nextRateConnection + 1) % connections.length

      const connection = connections[index]

      if (connection?.canQueueRateRequest()) {
        return connection
      }
    }

    return null
  }

  function statusCodesResult(): Record<string, number> {
    const result: Record<string, number> = {}

    for (let statusCode = 100; statusCode < statusCodeCounts.length; statusCode++) {
      const count = statusCodeCounts[statusCode] ?? 0

      if (count > 0) {
        result[String(statusCode)] = count
      }
    }

    return result
  }

  class Http1Connection {
    readonly timestamps = new TimestampQueue(data.pipelining)
    readonly #parser = new Http1ResponseParser({
      requestMethod: data.method,
      maxHeaderBytes: data.maxHeaderBytes
    })
    readonly #rateBatch: number[] = []

    #socket: Socket | TLSSocket | null = null
    #connected = false
    #reconnectScheduled = false
    #stopped = false
    #protocolFailure = false
    #timeoutFailure = false
    #backpressured = false
    #backpressureMeasured = false
    #backpressureStartedAt = 0
    #pendingClosedLoop = 0

    connect(): void {
      if (this.#stopped || this.#socket) {
        return
      }

      const socket = createSocket(data)

      this.#socket = socket
      socket.setNoDelay(true)
      socket.setTimeout(data.timeoutMs)
      socket.once(data.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
        if (this.#stopped || socket !== this.#socket) {
          return
        }

        this.#connected = true
        this.#reconnectScheduled = false
        onConnected(this)
      })
      socket.on('data', (chunk: Buffer) => {
        if (socket !== this.#socket || this.#stopped) {
          return
        }

        if (isMeasurement()) {
          bytesRead += chunk.length
        }

        try {
          let replenish = 0

          this.#parser.push(chunk, (statusCode) => {
            if (onResponse(this, statusCode)) {
              replenish++
            }
          })

          if (replenish > 0) {
            this.#replenishClosedLoop(replenish)
          }
        } catch {
          if (isMeasurement()) {
            errors.protocol++
          }

          this.#protocolFailure = true
          socket.destroy()
        }
      })
      socket.on('drain', () => {
        if (socket !== this.#socket || !this.#backpressured) {
          return
        }

        this.#endBackpressure()

        if (this.#pendingClosedLoop > 0 && running && isClosedLoop()) {
          const pending = this.#pendingClosedLoop

          this.#pendingClosedLoop = 0
          this.#send(pending)
        }
      })
      socket.on('timeout', () => {
        if (isMeasurement()) {
          errors.timeout++
        }

        this.#timeoutFailure = true
        socket.destroy()
      })
      socket.on('error', () => {
        if (isMeasurement() && !this.#protocolFailure && !this.#timeoutFailure) {
          errors.connection++
        }
      })
      socket.once('close', () => {
        if (socket !== this.#socket) {
          return
        }

        this.#socket = null
        this.#endBackpressure()

        if (this.#connected) {
          this.#connected = false
          onDisconnected()
        }

        if (isMeasurement() && phase !== 'finished' && this.timestamps.size > 0) {
          errors.abortedRequests += this.timestamps.size
        }

        this.timestamps.clear()
        this.#rateBatch.length = 0
        this.#pendingClosedLoop = 0
        this.#parser.reset()
        this.#protocolFailure = false
        this.#timeoutFailure = false

        if (phase === 'warmup-draining') {
          maybeCompleteWarmup()
        }

        if (!this.#stopped && phase !== 'finished') {
          this.#scheduleReconnect()
        }
      })
    }

    fillPipeline(): void {
      if (!running || !isClosedLoop() || !this.#connected || this.timestamps.size !== 0) {
        return
      }

      this.#replenishClosedLoop(data.pipelining)
    }

    canQueueRateRequest(): boolean {
      return (
        running &&
        !isClosedLoop() &&
        this.#connected &&
        !this.#stopped &&
        !this.#backpressured &&
        this.timestamps.size + this.#rateBatch.length < data.pipelining
      )
    }

    queueRateRequest(scheduledAt: number): void {
      if (!this.canQueueRateRequest()) {
        throw new Error('HTTP/1 fixed-rate scheduler exceeded connection capacity')
      }

      this.#rateBatch.push(scheduledAt)
    }

    flushRateRequests(): void {
      if (this.#rateBatch.length === 0) {
        return
      }

      this.#send(this.#rateBatch.length, this.#rateBatch)
      this.#rateBatch.length = 0
    }

    reconnectAfterProtocolError(): void {
      this.#protocolFailure = true
      this.#socket?.destroy()
    }

    resetPhaseState(): void {
      this.#rateBatch.length = 0
      this.#pendingClosedLoop = 0
    }

    stop(): void {
      this.#stopped = true
      this.#endBackpressure()
      this.#socket?.destroy()
      this.#socket = null
      this.timestamps.clear()
      this.#rateBatch.length = 0
      this.#pendingClosedLoop = 0
    }

    #replenishClosedLoop(count: number): void {
      if (!running || !isClosedLoop() || count <= 0) {
        return
      }

      if (this.#backpressured) {
        this.#pendingClosedLoop += count

        return
      }

      this.#send(count)
    }

    #send(count: number, scheduledTimes?: readonly number[]): void {
      const socket = this.#socket

      if (!socket || !this.#connected || this.#stopped || count <= 0) {
        return
      }

      const available = data.pipelining - this.timestamps.size

      if (count > available) {
        throw new Error('HTTP/1 pipeline timestamp queue overflow')
      }

      const now = performance.now()

      for (let index = 0; index < count; index++) {
        const scheduledAt = scheduledTimes?.[index]
        const timestamp = scheduledAt !== undefined && data.correctCoordinatedOmission ? scheduledAt : now

        this.timestamps.push(timestamp)

        if (isMeasurement() && scheduledAt !== undefined) {
          const lag = Math.max(0, now - scheduledAt)

          scheduleLagTotalMs += lag
          maxScheduleLagMs = Math.max(maxScheduleLagMs, lag)
          scheduledRequests++
        }
      }

      if (isMeasurement()) {
        sent += count
        bytesWritten += request.length * count
      }

      let accepted = true

      if (count === data.pipelining && requestBatch) {
        accepted = socket.write(requestBatch)

        if (isMeasurement()) {
          socketWriteCalls++
        }
      } else if (count === 1) {
        accepted = socket.write(request)

        if (isMeasurement()) {
          socketWriteCalls++
        }
      } else {
        socket.cork()

        for (let index = 0; index < count; index++) {
          accepted = socket.write(request) && accepted

          if (isMeasurement()) {
            socketWriteCalls++
          }
        }

        socket.uncork()
      }

      if (!accepted) {
        this.#startBackpressure()
      }
    }

    #startBackpressure(): void {
      if (this.#backpressured) {
        return
      }

      this.#backpressured = true
      this.#backpressureMeasured = isMeasurement()
      this.#backpressureStartedAt = performance.now()

      if (this.#backpressureMeasured) {
        backpressureEvents++
      }
    }

    #endBackpressure(): void {
      if (!this.#backpressured) {
        return
      }

      if (this.#backpressureMeasured) {
        drainWaitMs += performance.now() - this.#backpressureStartedAt
      }

      this.#backpressured = false
      this.#backpressureMeasured = false
      this.#backpressureStartedAt = 0
    }

    #scheduleReconnect(): void {
      if (this.#reconnectScheduled) {
        return
      }

      this.#reconnectScheduled = true
      setTimeout(() => {
        this.#reconnectScheduled = false
        this.connect()
      }, 25)
    }
  }

  for (let index = 0; index < data.connections; index++) {
    const connection = new Http1Connection()

    connections.push(connection)
    connection.connect()
  }

  port.on('message', (message: Http1WorkerCommand) => {
    try {
      if (message.type === 'start') {
        startPhase(message)
      } else {
        phase = 'finished'
        running = false
        clearPhaseTimers()

        for (const connection of connections) {
          connection.stop()
        }

        port.close()
      }
    } catch (error) {
      post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) })
      port.close()
    }
  })
}

class TimestampQueue {
  readonly #values: Float64Array

  #head = 0
  #size = 0

  constructor(capacity: number) {
    this.#values = new Float64Array(capacity)
  }

  get size(): number {
    return this.#size
  }

  push(value: number): void {
    if (this.#size === this.#values.length) {
      throw new Error('HTTP/1 pipeline timestamp queue overflow')
    }

    const index = (this.#head + this.#size) % this.#values.length

    this.#values[index] = value
    this.#size++
  }

  shift(): number | null {
    if (this.#size === 0) {
      return null
    }

    const value = this.#values[this.#head] ?? 0

    this.#head = (this.#head + 1) % this.#values.length
    this.#size--

    return value
  }

  clear(): void {
    this.#head = 0
    this.#size = 0
  }
}

function createSocket(data: Http1WorkerData): Socket | TLSSocket {
  if (data.protocol === 'https:') {
    const tlsOptions = normalizeTlsOptions(data.tls)

    return tls.connect({
      ...tlsOptions,
      ...(data.socketPath ? { path: data.socketPath } : { host: data.hostname, port: data.port }),
      servername: data.tls?.servername ?? (net.isIP(data.hostname) ? undefined : data.hostname)
    })
  }

  return data.socketPath
    ? net.createConnection({ path: data.socketPath })
    : net.createConnection(data.port, data.hostname)
}

function normalizeTlsOptions(options: Http1WorkerData['tls']): tls.ConnectionOptions {
  if (!options) {
    return {}
  }

  return {
    ...(options.rejectUnauthorized === undefined ? {} : { rejectUnauthorized: options.rejectUnauthorized }),
    ...(options.servername === undefined ? {} : { servername: options.servername }),
    ...(options.ca === undefined ? {} : { ca: normalizeTlsMaterial(options.ca) }),
    ...(options.cert === undefined ? {} : { cert: normalizeTlsMaterial(options.cert) }),
    ...(options.key === undefined ? {} : { key: normalizeTlsMaterial(options.key) })
  }
}

function normalizeTlsMaterial(
  value: string | Buffer | readonly (string | Buffer)[]
): string | Buffer | Array<string | Buffer> {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeTlsValue(entry))
  }

  return normalizeTlsValue(value as string | Buffer)
}

function normalizeTlsValue(value: string | Buffer): string | Buffer {
  return typeof value === 'string' ? value : Buffer.from(value)
}

function post(message: Http1WorkerMessage): void {
  port.postMessage(message)
}

void runWorker(workerData as Http1WorkerData).catch((error: unknown) => {
  post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) })
  port.close()
})
