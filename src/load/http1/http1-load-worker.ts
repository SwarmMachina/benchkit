import { performance } from 'node:perf_hooks'
import { type MessagePort } from 'node:worker_threads'
import { Http1Connection, type Http1ConnectionOwner } from './http1-connection.js'
import { Http1WorkerMeasurement } from './http1-worker-measurement.js'
import type { Http1WorkerCommand, Http1WorkerData, Http1WorkerMessage } from './worker-protocol.js'

const RATE_TICK_MS = 1
const MAX_BATCH_BYTES = 1024 * 1024

type WorkerPhase = 'idle' | 'warmup' | 'warmup-draining' | 'measurement' | 'finished'

export class Http1LoadWorker implements Http1ConnectionOwner {
  readonly #port: MessagePort
  readonly #data: Http1WorkerData
  readonly #request: Buffer
  readonly #requestBatch: Buffer | null
  readonly #measurement = new Http1WorkerMeasurement()
  readonly #connections: Http1Connection[] = []

  #connected = 0
  #readySent = false
  #phase: WorkerPhase = 'idle'
  #running = false
  #startedAt = 0
  #stopAt = 0
  #stopTimer: NodeJS.Timeout | null = null
  #rateTimer: NodeJS.Timeout | null = null
  #memoryTimer: NodeJS.Timeout | null = null
  #phaseScheduled = 0
  #nextRateConnection = 0

  constructor(port: MessagePort, data: Http1WorkerData) {
    this.#port = port
    this.#data = data
    this.#request = Buffer.from(data.request)
    this.#requestBatch =
      this.#request.length * data.pipelining <= MAX_BATCH_BYTES
        ? Buffer.concat(Array.from({ length: data.pipelining }, () => this.#request))
        : null
  }

  get closedLoopActive(): boolean {
    return this.#running && this.#data.ratePerSecond === undefined
  }

  get fixedRateActive(): boolean {
    return this.#running && this.#data.ratePerSecond !== undefined
  }

  start(): void {
    this.#port.on('message', this.#onMessage)

    try {
      for (let index = 0; index < this.#data.connections; index++) {
        const connection = new Http1Connection(this, this.#data, this.#request, this.#requestBatch)

        this.#connections.push(connection)
        connection.connect()
      }
    } catch (error) {
      this.#stopConnections()
      throw error
    }
  }

  fail(error: unknown): void {
    this.#phase = 'finished'
    this.#running = false
    this.#clearPhaseTimers()
    this.#stopConnections()
    this.#post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) })
    this.#port.close()
  }

  onConnectionConnected(): void {
    this.#connected++

    if (!this.#readySent && this.#connected === this.#data.connections) {
      this.#readySent = true
      this.#post({ type: 'ready' })
    }
  }

  onConnectionDisconnected(): void {
    this.#connected = Math.max(0, this.#connected - 1)

    if (this.#phase === 'warmup-draining') {
      this.#maybeCompleteWarmup()
    }
  }

  onConnectionClosed(abortedRequests: number): boolean {
    if (this.#isMeasurement() && abortedRequests > 0) {
      this.#measurement.recordAbortedRequests(abortedRequests)
    }

    if (this.#phase === 'warmup-draining') {
      this.#maybeCompleteWarmup()
    }

    return this.#phase !== 'finished'
  }

  onResponse(statusCode: number, sentAt: number): boolean {
    const now = performance.now()

    if (this.#isMeasurement()) {
      this.#measurement.recordResponse(statusCode, now - sentAt)
    }

    if (this.#phase === 'warmup-draining') {
      this.#maybeCompleteWarmup()
    }

    return this.closedLoopActive && now < this.#stopAt
  }

  onBytesRead(bytes: number): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordBytesRead(bytes)
    }
  }

  onProtocolError(): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordProtocolError()
    }
  }

  onTimeout(): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordTimeout()
    }
  }

  onConnectionError(): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordConnectionError()
    }
  }

  onRequestsSent(count: number, bytes: number): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordRequestsSent(count, bytes)
    }
  }

  onSocketWrite(): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordSocketWrite()
    }
  }

  onScheduledRequest(lagMs: number): void {
    if (this.#isMeasurement()) {
      this.#measurement.recordScheduleLag(lagMs)
    }
  }

  onBackpressureStarted(): boolean {
    if (!this.#isMeasurement()) {
      return false
    }

    this.#measurement.recordBackpressure()

    return true
  }

  onBackpressureEnded(durationMs: number): void {
    this.#measurement.recordDrainWait(durationMs)
  }

  readonly #onMessage = (message: Http1WorkerCommand): void => {
    try {
      if (message.type === 'start') {
        this.#startPhase(message)
      } else {
        this.#phase = 'finished'
        this.#running = false
        this.#clearPhaseTimers()
        this.#stopConnections()
        this.#port.close()
      }
    } catch (error) {
      this.fail(error)
    }
  }

  #isMeasurement(): boolean {
    return this.#phase === 'measurement'
  }

  #startPhase(command: Extract<Http1WorkerCommand, { type: 'start' }>): void {
    if (this.#phase !== 'idle') {
      throw new Error(`cannot start HTTP/1 ${command.phase} phase while worker is ${this.#phase}`)
    }

    if (command.phase === 'measurement') {
      for (const connection of this.#connections) {
        connection.resetPhaseState()
      }

      this.#phase = 'measurement'
      this.#measurement.start()
      this.#memoryTimer = setInterval(() => this.#measurement.sampleMemory(), this.#data.memorySampleMs)
    } else {
      this.#phase = 'warmup'
    }

    this.#running = true
    this.#startedAt = performance.now()
    this.#stopAt = this.#startedAt + command.durationMs
    this.#phaseScheduled = 0
    this.#nextRateConnection = 0

    if (this.#data.ratePerSecond === undefined) {
      for (const connection of this.#connections) {
        connection.fillPipeline()
      }
    } else {
      this.#rateTimer = setInterval(this.#scheduleRate, RATE_TICK_MS)
    }

    this.#stopTimer = setTimeout(this.#endPhase, command.durationMs)
  }

  readonly #endPhase = (): void => {
    if (this.#phase !== 'warmup' && this.#phase !== 'measurement') {
      return
    }

    this.#running = false
    this.#clearPhaseTimers()

    if (this.#phase === 'warmup') {
      this.#phase = 'warmup-draining'
      this.#maybeCompleteWarmup()

      return
    }

    this.#phase = 'finished'

    const inFlightAtStop = this.#totalInFlight()

    this.#stopConnections()

    const result = this.#measurement.finish(this.#startedAt, inFlightAtStop)

    this.#post({ type: 'result', result })
    this.#port.close()
  }

  #maybeCompleteWarmup(): void {
    if (this.#phase !== 'warmup-draining' || this.#totalInFlight() !== 0) {
      return
    }

    for (const connection of this.#connections) {
      connection.resetPhaseState()
    }

    this.#phase = 'idle'
    this.#post({ type: 'warmup-complete' })
  }

  #clearPhaseTimers(): void {
    if (this.#stopTimer) {
      clearTimeout(this.#stopTimer)
      this.#stopTimer = null
    }

    if (this.#rateTimer) {
      clearInterval(this.#rateTimer)
      this.#rateTimer = null
    }

    if (this.#memoryTimer) {
      clearInterval(this.#memoryTimer)
      this.#memoryTimer = null
    }
  }

  #stopConnections(): void {
    for (const connection of this.#connections) {
      connection.stop()
    }
  }

  #totalInFlight(): number {
    let total = 0

    for (const connection of this.#connections) {
      total += connection.inFlight
    }

    return total
  }

  readonly #scheduleRate = (): void => {
    const rate = this.#data.ratePerSecond

    if (!this.#running || rate === undefined) {
      return
    }

    const now = performance.now()
    const globalExpected = Math.floor(((Math.min(now, this.#stopAt) - this.#startedAt) * rate) / 1000)
    const expected =
      globalExpected <= this.#data.rateSequenceOffset
        ? 0
        : Math.floor((globalExpected - 1 - this.#data.rateSequenceOffset) / this.#data.rateSequenceStride) + 1

    let due = expected - this.#phaseScheduled

    while (due > 0) {
      const sequence = this.#data.rateSequenceOffset + 1 + this.#phaseScheduled * this.#data.rateSequenceStride
      const scheduledAt = this.#startedAt + (sequence * 1000) / rate
      const connection = this.#nextAvailableRateConnection()

      this.#phaseScheduled++
      due--

      if (connection) {
        connection.queueRateRequest(scheduledAt)
      } else {
        if (this.#isMeasurement()) {
          this.#measurement.recordRateDropped(due + 1)
        }

        this.#phaseScheduled += due
        due = 0
      }
    }

    for (const connection of this.#connections) {
      connection.flushRateRequests()
    }
  }

  #nextAvailableRateConnection(): Http1Connection | null {
    for (let attempt = 0; attempt < this.#connections.length; attempt++) {
      const index = this.#nextRateConnection

      this.#nextRateConnection = (this.#nextRateConnection + 1) % this.#connections.length

      const connection = this.#connections[index]

      if (connection?.canQueueRateRequest()) {
        return connection
      }
    }

    return null
  }

  #post(message: Http1WorkerMessage): void {
    this.#port.postMessage(message)
  }
}
