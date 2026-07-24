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

async function runWorker(data: Http1WorkerData): Promise<void> {
  const request = Buffer.from(data.request)
  const requestBatch =
    request.length * data.pipelining <= 1024 * 1024
      ? Buffer.concat(Array.from({ length: data.pipelining }, () => request))
      : null
  const latency = createBoundedLatencyRecorder()
  const statusCodes: Record<string, number> = {}
  const errors: Http1WorkerErrorMetrics = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    abortedRequests: 0
  }
  const connections = new Set<Http1Connection>()

  let connected = 0
  let readySent = false
  let running = false
  let stopping = false
  let startedAt = 0
  let stopAt = 0
  let stopTimer: NodeJS.Timeout | null = null
  let memoryTimer: NodeJS.Timeout | null = null
  let sent = 0
  let completed = 0
  let bytesRead = 0
  let non2xx = 0
  let eluBefore: ReturnType<typeof performance.eventLoopUtilization> | null = null
  let heapUsedPeakBytes = 0
  let externalPeakBytes = 0
  let arrayBuffersPeakBytes = 0

  function sampleMemory(): void {
    const memory = process.memoryUsage()

    heapUsedPeakBytes = Math.max(heapUsedPeakBytes, memory.heapUsed)
    externalPeakBytes = Math.max(externalPeakBytes, memory.external)
    arrayBuffersPeakBytes = Math.max(arrayBuffersPeakBytes, memory.arrayBuffers)
  }

  function onConnected(connection: Http1Connection): void {
    connected++

    if (running) {
      connection.fillPipeline()
    }

    if (!readySent && connected === data.connections) {
      readySent = true
      post({ type: 'ready' })
    }
  }

  function onDisconnected(): void {
    connected = Math.max(0, connected - 1)
  }

  function onResponse(connection: Http1Connection, statusCode: number): boolean {
    const sentAt = connection.timestamps.shift()

    if (sentAt === null) {
      errors.protocol++
      connection.reconnectAfterProtocolError()

      return false
    }

    const now = performance.now()

    completed++
    statusCodes[String(statusCode)] = (statusCodes[String(statusCode)] ?? 0) + 1

    if (statusCode < 200 || statusCode >= 300) {
      non2xx++
    }

    latency.record(now - sentAt)

    return running && now < stopAt
  }

  function start(): void {
    if (running || stopping) {
      return
    }

    running = true
    startedAt = performance.now()
    stopAt = startedAt + data.durationMs
    eluBefore = performance.eventLoopUtilization()
    sampleMemory()
    memoryTimer = setInterval(sampleMemory, data.memorySampleMs)

    for (const connection of connections) {
      connection.fillPipeline()
    }

    stopTimer = setTimeout(finish, data.durationMs)
  }

  function finish(): void {
    if (stopping) {
      return
    }

    stopping = true
    running = false

    if (stopTimer) {
      clearTimeout(stopTimer)
    }

    if (memoryTimer) {
      clearInterval(memoryTimer)
    }

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
      bytesRead,
      statusCodes,
      non2xx,
      errors,
      latencySnapshot: latency.snapshot(),
      eluPct: elu.utilization * 100,
      heapUsedPeakBytes,
      externalPeakBytes,
      arrayBuffersPeakBytes
    }

    post({ type: 'result', result })
    port.close()
  }

  class Http1Connection {
    readonly timestamps = new TimestampQueue(data.pipelining)
    readonly #parser = new Http1ResponseParser({
      requestMethod: data.method,
      maxHeaderBytes: data.maxHeaderBytes
    })

    #socket: Socket | TLSSocket | null = null
    #connected = false
    #reconnectScheduled = false
    #stopped = false
    #protocolFailure = false
    #timeoutFailure = false

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

        bytesRead += chunk.length

        try {
          // Refill once per received TCP chunk. Writing once per completed
          // response turns the load generator into a syscall bottleneck at
          // high pipeline depths without changing the outstanding request cap.
          let replenish = 0

          this.#parser.push(chunk, (statusCode) => {
            if (onResponse(this, statusCode)) {
              replenish++
            }
          })

          if (replenish > 0) {
            this.send(replenish)
          }
        } catch {
          errors.protocol++
          this.#protocolFailure = true
          socket.destroy()
        }
      })
      socket.on('timeout', () => {
        if (running) {
          errors.timeout++
        }

        this.#timeoutFailure = true
        socket.destroy()
      })
      socket.on('error', () => {
        if (running && !this.#protocolFailure && !this.#timeoutFailure) {
          errors.connection++
        }
      })
      socket.once('close', () => {
        if (socket !== this.#socket) {
          return
        }

        this.#socket = null

        if (this.#connected) {
          this.#connected = false
          onDisconnected()
        }

        if (!stopping && this.timestamps.size > 0) {
          errors.abortedRequests += this.timestamps.size
        }

        this.timestamps.clear()
        this.#parser.reset()
        this.#protocolFailure = false
        this.#timeoutFailure = false

        if (!this.#stopped && !stopping) {
          this.#scheduleReconnect()
        }
      })
    }

    fillPipeline(): void {
      if (!running || !this.#connected || this.timestamps.size !== 0) {
        return
      }

      this.send(data.pipelining)
    }

    send(count: number): void {
      const socket = this.#socket

      if (!socket || !this.#connected || this.#stopped || count <= 0) {
        return
      }

      const now = performance.now()

      for (let index = 0; index < count; index++) {
        this.timestamps.push(now)
      }

      sent += count

      if (count === data.pipelining && requestBatch) {
        socket.write(requestBatch)
      } else if (count === 1) {
        socket.write(request)
      } else {
        socket.cork()

        for (let index = 0; index < count; index++) {
          socket.write(request)
        }

        socket.uncork()
      }
    }

    reconnectAfterProtocolError(): void {
      this.#protocolFailure = true
      this.#socket?.destroy()
    }

    stop(): void {
      this.#stopped = true
      this.#socket?.destroy()
      this.#socket = null
      this.timestamps.clear()
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

    connections.add(connection)
    connection.connect()
  }

  port.on('message', (message: Http1WorkerCommand) => {
    if (message.type === 'start') {
      start()
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
