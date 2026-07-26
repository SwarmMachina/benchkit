import { performance } from 'node:perf_hooks'
import { LoadConnection, type LoadConnectionOwner } from '../shared/load-connection.js'
import { TimestampQueue } from '../shared/timestamp-queue.js'
import type { WebSocketWorkerData } from './worker-protocol.js'

const BACKPRESSURE_POLL_MS = 1
const RECONNECT_DELAY_MS = 25

export interface WebSocketConnectionOwner extends LoadConnectionOwner {
  readonly closedLoopActive: boolean
  readonly fixedRateActive: boolean
  onConnectionConnected(): void
  onConnectionDisconnected(): void
  onConnectionClosed(abortedMessages: number): void
  onConnectionIdle(): void
  onMessage(payloadBytes: number, sentAt: number): void
  onMessageSent(payloadBytes: number): void
  onScheduledOperation(lagMs: number): void
  onConnectionError(): void
  onTimeout(): void
  onProtocolError(): void
  onBufferedAmount(bytes: number): void
}

export class WebSocketConnection extends LoadConnection {
  readonly #owner: WebSocketConnectionOwner
  readonly #data: WebSocketWorkerData
  readonly #timestamps: TimestampQueue
  readonly #payloadBytes: number

  #socket: WebSocket | null = null
  #connected = false
  #stopped = false
  #connectionErrorObserved = false
  #backpressureTimer: NodeJS.Timeout | null = null
  #timeoutTimer: NodeJS.Timeout | null = null
  #reconnectTimer: NodeJS.Timeout | null = null

  constructor(owner: WebSocketConnectionOwner, data: WebSocketWorkerData) {
    super(owner)
    this.#owner = owner
    this.#data = data
    this.#timestamps = new TimestampQueue(data.maxInFlight, { trackTimeouts: true })
    this.#payloadBytes = typeof data.message === 'string' ? Buffer.byteLength(data.message) : data.message.byteLength
  }

  get inFlight(): number {
    return this.#timestamps.size
  }

  connect(): void {
    if (this.#stopped || this.#socket) {
      return
    }

    const socket = new WebSocket(this.#data.url, this.#data.protocols)

    this.#socket = socket
    this.#connectionErrorObserved = false
    socket.binaryType = 'arraybuffer'

    socket.addEventListener('open', () => {
      if (socket !== this.#socket || this.#stopped) {
        return
      }

      this.#connected = true
      this.#owner.onConnectionConnected()
      this.fillClosedLoop()
    })

    socket.addEventListener('message', (event) => {
      if (socket !== this.#socket || this.#stopped) {
        return
      }

      const payloadBytes = messageByteLength(event.data)
      const sentAt = this.#timestamps.shift()

      if (payloadBytes === null || sentAt === null) {
        this.#owner.onProtocolError()
        this.#discard(socket)

        return
      }

      this.#owner.onMessage(payloadBytes, sentAt)
      this.#scheduleTimeout()
      this.#owner.onConnectionIdle()

      if (this.backpressured && socket.bufferedAmount <= this.#data.maxBufferedBytes) {
        this.#endBackpressure()
      }

      this.fillClosedLoop()
    })

    socket.addEventListener('error', () => {
      if (socket === this.#socket && !this.#stopped && !this.#connectionErrorObserved) {
        this.#connectionErrorObserved = true
        this.#owner.onConnectionError()
      }
    })

    socket.addEventListener('close', () => {
      if (socket !== this.#socket) {
        return
      }

      this.#socket = null
      this.#clearConnectionTimers()
      this.#endBackpressure()

      if (this.#connected) {
        this.#connected = false
        this.#owner.onConnectionDisconnected()
      }

      if (!this.#stopped && !this.#connectionErrorObserved) {
        this.#owner.onConnectionError()
      }

      const aborted = this.#timestamps.size

      this.#timestamps.clear()
      this.#owner.onConnectionClosed(aborted)
      this.#owner.onConnectionIdle()

      if (!this.#stopped) {
        this.#scheduleReconnect()
      }
    })
  }

  fillClosedLoop(): void {
    if (!this.#owner.closedLoopActive || !this.#connected || this.#stopped || this.backpressured || !this.#socket) {
      return
    }

    while (this.#timestamps.size < this.#data.maxInFlight && !this.backpressured) {
      if (!this.#send()) {
        return
      }
    }
  }

  canScheduleOperation(): boolean {
    const socket = this.#socket

    return (
      this.#owner.fixedRateActive &&
      this.#connected &&
      !this.#stopped &&
      !this.backpressured &&
      socket?.readyState === WebSocket.OPEN &&
      socket.bufferedAmount <= this.#data.maxBufferedBytes &&
      this.#timestamps.size < this.#data.maxInFlight
    )
  }

  scheduleOperation(scheduledAt: number): void {
    if (!this.canScheduleOperation()) {
      throw new Error('WebSocket fixed-rate scheduler exceeded connection capacity')
    }

    this.#send(scheduledAt)
  }

  resetPhaseState(): void {
    this.#timestamps.clear()
    this.#clearTimeoutTimer()
  }

  stop(): void {
    this.#stopped = true
    this.#clearConnectionTimers()
    this.#clearReconnectTimer()
    this.#endBackpressure()

    const socket = this.#socket

    this.#socket = null
    this.#connected = false
    this.#timestamps.clear()

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'benchmark complete')
    }
  }

  #send(scheduledAt?: number): boolean {
    const socket = this.#socket

    if (!socket || socket.readyState !== WebSocket.OPEN || this.#timestamps.size >= this.#data.maxInFlight) {
      return false
    }

    const now = performance.now()
    const timestamp = scheduledAt !== undefined && this.#data.correctCoordinatedOmission ? scheduledAt : now

    try {
      socket.send(this.#data.message)
    } catch {
      this.#owner.onConnectionError()
      this.#discard(socket)

      return false
    }

    this.#timestamps.push(timestamp, now)
    this.#owner.onMessageSent(this.#payloadBytes)

    if (scheduledAt !== undefined) {
      this.#owner.onScheduledOperation(Math.max(0, now - scheduledAt))
    }

    this.#owner.onBufferedAmount(socket.bufferedAmount)
    this.#scheduleTimeout()

    if (socket.bufferedAmount > this.#data.maxBufferedBytes) {
      this.#startBackpressure()
    }

    return true
  }

  #scheduleTimeout(): void {
    this.#clearTimeoutTimer()

    const oldest = this.#timestamps.peekTimeoutStart()

    if (oldest === null) {
      return
    }

    const delayMs = Math.max(1, oldest + this.#data.timeoutMs - performance.now())

    this.#timeoutTimer = setTimeout(() => {
      this.#timeoutTimer = null

      if (this.#timestamps.size === 0 || !this.#socket) {
        return
      }

      this.#owner.onTimeout()
      this.#discard(this.#socket)
    }, delayMs)
  }

  #discard(socket: WebSocket): void {
    if (socket !== this.#socket) {
      return
    }

    this.#socket = null
    this.#clearConnectionTimers()
    this.#endBackpressure()

    if (this.#connected) {
      this.#connected = false
      this.#owner.onConnectionDisconnected()
    }

    const aborted = this.#timestamps.size

    this.#timestamps.clear()
    this.#owner.onConnectionClosed(aborted)
    this.#owner.onConnectionIdle()

    if (socket.readyState < WebSocket.CLOSING) {
      socket.close(1001, 'connection discarded')
    }

    if (!this.#stopped) {
      this.#scheduleReconnect()
    }
  }

  #startBackpressure(): void {
    if (!this.beginBackpressure()) {
      return
    }

    this.#pollBackpressure()
  }

  #pollBackpressure(): void {
    if (!this.backpressured || this.#stopped) {
      return
    }

    this.#backpressureTimer = setTimeout(() => {
      this.#backpressureTimer = null

      const socket = this.#socket

      if (!socket || socket.bufferedAmount <= this.#data.maxBufferedBytes) {
        this.#endBackpressure()
        this.fillClosedLoop()
      } else {
        this.#owner.onBufferedAmount(socket.bufferedAmount)
        this.#pollBackpressure()
      }
    }, BACKPRESSURE_POLL_MS)
  }

  #endBackpressure(): void {
    if (!this.backpressured) {
      return
    }

    if (this.#backpressureTimer) {
      clearTimeout(this.#backpressureTimer)
      this.#backpressureTimer = null
    }

    this.finishBackpressure()
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer || this.#stopped) {
      return
    }

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null
      this.connect()
    }, RECONNECT_DELAY_MS)
  }

  #clearConnectionTimers(): void {
    this.#clearTimeoutTimer()

    if (this.#backpressureTimer) {
      clearTimeout(this.#backpressureTimer)
      this.#backpressureTimer = null
    }
  }

  #clearTimeoutTimer(): void {
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer)
      this.#timeoutTimer = null
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
  }
}

function messageByteLength(value: unknown): number | null {
  if (typeof value === 'string') {
    return Buffer.byteLength(value)
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }

  return null
}
