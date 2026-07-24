import net, { type Socket } from 'node:net'
import { performance } from 'node:perf_hooks'
import tls, { type TLSSocket } from 'node:tls'
import { Http1ResponseParser } from './response-parser.js'
import { TimestampQueue } from './timestamp-queue.js'
import type { Http1WorkerData } from './worker-protocol.js'

export interface Http1ConnectionOwner {
  readonly closedLoopActive: boolean
  readonly fixedRateActive: boolean

  onConnectionConnected(): void
  onConnectionDisconnected(): void
  onConnectionClosed(abortedRequests: number): boolean
  onResponse(statusCode: number, sentAt: number): boolean
  onBytesRead(bytes: number): void
  onProtocolError(): void
  onTimeout(): void
  onConnectionError(): void
  onRequestsSent(count: number, bytes: number): void
  onSocketWrite(): void
  onScheduledRequest(lagMs: number): void
  onBackpressureStarted(): boolean
  onBackpressureEnded(durationMs: number): void
}

export class Http1Connection {
  readonly #owner: Http1ConnectionOwner
  readonly #data: Http1WorkerData
  readonly #request: Buffer
  readonly #requestBatch: Buffer | null
  readonly #timestamps: TimestampQueue
  readonly #parser: Http1ResponseParser
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

  constructor(owner: Http1ConnectionOwner, data: Http1WorkerData, request: Buffer, requestBatch: Buffer | null) {
    this.#owner = owner
    this.#data = data
    this.#request = request
    this.#requestBatch = requestBatch
    this.#timestamps = new TimestampQueue(data.pipelining)
    this.#parser = new Http1ResponseParser({
      requestMethod: data.method,
      maxHeaderBytes: data.maxHeaderBytes
    })
  }

  get inFlight(): number {
    return this.#timestamps.size
  }

  connect(): void {
    if (this.#stopped || this.#socket) {
      return
    }

    const socket = openSocket(this.#data)

    this.#socket = socket
    socket.setNoDelay(true)
    socket.setTimeout(this.#data.timeoutMs)
    socket.once(this.#data.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
      if (this.#stopped || socket !== this.#socket) {
        return
      }

      this.#connected = true
      this.#reconnectScheduled = false
      this.#owner.onConnectionConnected()

      if (this.#owner.closedLoopActive) {
        this.fillPipeline()
      }
    })
    socket.on('data', (chunk: Buffer) => {
      if (socket !== this.#socket || this.#stopped) {
        return
      }

      this.#owner.onBytesRead(chunk.length)

      try {
        let replenish = 0

        this.#parser.push(chunk, (statusCode) => {
          const sentAt = this.#timestamps.shift()

          if (sentAt === null) {
            this.#owner.onProtocolError()
            this.reconnectAfterProtocolError()

            return
          }

          if (this.#owner.onResponse(statusCode, sentAt)) {
            replenish++
          }
        })

        if (replenish > 0) {
          this.#replenishClosedLoop(replenish)
        }
      } catch {
        this.#owner.onProtocolError()
        this.#protocolFailure = true
        socket.destroy()
      }
    })
    socket.on('drain', () => {
      if (socket !== this.#socket || !this.#backpressured) {
        return
      }

      this.#endBackpressure()

      if (this.#pendingClosedLoop > 0 && this.#owner.closedLoopActive) {
        const pending = this.#pendingClosedLoop

        this.#pendingClosedLoop = 0
        this.#send(pending)
      }
    })
    socket.on('timeout', () => {
      this.#owner.onTimeout()
      this.#timeoutFailure = true
      socket.destroy()
    })
    socket.on('error', () => {
      if (!this.#protocolFailure && !this.#timeoutFailure) {
        this.#owner.onConnectionError()
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
        this.#owner.onConnectionDisconnected()
      }

      const shouldReconnect = this.#owner.onConnectionClosed(this.#timestamps.size)

      this.#timestamps.clear()
      this.#rateBatch.length = 0
      this.#pendingClosedLoop = 0
      this.#parser.reset()
      this.#protocolFailure = false
      this.#timeoutFailure = false

      if (!this.#stopped && shouldReconnect) {
        this.#scheduleReconnect()
      }
    })
  }

  fillPipeline(): void {
    if (!this.#owner.closedLoopActive || !this.#connected || this.#timestamps.size !== 0) {
      return
    }

    this.#replenishClosedLoop(this.#data.pipelining)
  }

  canQueueRateRequest(): boolean {
    return (
      this.#owner.fixedRateActive &&
      this.#connected &&
      !this.#stopped &&
      !this.#backpressured &&
      this.#timestamps.size + this.#rateBatch.length < this.#data.pipelining
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
    this.#timestamps.clear()
    this.#rateBatch.length = 0
    this.#pendingClosedLoop = 0
  }

  #replenishClosedLoop(count: number): void {
    if (!this.#owner.closedLoopActive || count <= 0) {
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

    const available = this.#data.pipelining - this.#timestamps.size

    if (count > available) {
      throw new Error('HTTP/1 pipeline timestamp queue overflow')
    }

    const now = performance.now()

    for (let index = 0; index < count; index++) {
      const scheduledAt = scheduledTimes?.[index]
      const timestamp = scheduledAt !== undefined && this.#data.correctCoordinatedOmission ? scheduledAt : now

      this.#timestamps.push(timestamp)

      if (scheduledAt !== undefined) {
        this.#owner.onScheduledRequest(Math.max(0, now - scheduledAt))
      }
    }

    this.#owner.onRequestsSent(count, this.#request.length * count)

    let accepted = true

    if (count === this.#data.pipelining && this.#requestBatch) {
      accepted = socket.write(this.#requestBatch)
      this.#owner.onSocketWrite()
    } else if (count === 1) {
      accepted = socket.write(this.#request)
      this.#owner.onSocketWrite()
    } else {
      socket.cork()

      for (let index = 0; index < count; index++) {
        accepted = socket.write(this.#request) && accepted
        this.#owner.onSocketWrite()
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
    this.#backpressureMeasured = this.#owner.onBackpressureStarted()
    this.#backpressureStartedAt = performance.now()
  }

  #endBackpressure(): void {
    if (!this.#backpressured) {
      return
    }

    if (this.#backpressureMeasured) {
      this.#owner.onBackpressureEnded(performance.now() - this.#backpressureStartedAt)
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

function openSocket(data: Http1WorkerData): Socket | TLSSocket {
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
