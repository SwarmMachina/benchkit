import { performance } from 'node:perf_hooks'
import type { MessagePort } from 'node:worker_threads'
import { LoadConnection } from './load-connection.js'
import { LoadWorkerMeasurement } from './load-worker-measurement.js'
import type { LoadWorkerCommand, LoadWorkerData, LoadWorkerMessage, LoadWorkerResult } from './load-worker-protocol.js'

const RATE_TICK_MS = 1

type WorkerPhase = 'idle' | 'warmup' | 'warmup-draining' | 'measurement' | 'finished'

export abstract class LoadWorker<
  Data extends LoadWorkerData,
  Connection extends LoadConnection,
  Result extends LoadWorkerResult,
  Measurement extends LoadWorkerMeasurement<Result>
> {
  protected readonly data: Data
  protected readonly measurement: Measurement

  readonly #port: MessagePort
  readonly #connections: Connection[] = []

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

  protected constructor(port: MessagePort, data: Data, measurement: Measurement) {
    this.#port = port
    this.data = data
    this.measurement = measurement
  }

  protected abstract readonly loadName: string

  protected abstract createConnection(): Connection

  get closedLoopActive(): boolean {
    return this.#running && this.data.ratePerSecond === undefined
  }

  get fixedRateActive(): boolean {
    return this.#running && this.data.ratePerSecond !== undefined
  }

  protected get measurementActive(): boolean {
    return this.#phase === 'measurement'
  }

  protected get shouldReconnect(): boolean {
    return this.#phase !== 'finished'
  }

  start(): void {
    this.#port.on('message', this.#onMessage)

    try {
      for (let index = 0; index < this.data.connections; index++) {
        const connection = this.createConnection()

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

    if (!this.#readySent && this.#connected === this.data.connections) {
      this.#readySent = true
      this.#post({ type: 'ready' })
    }
  }

  onConnectionDisconnected(): void {
    this.#connected = Math.max(0, this.#connected - 1)
    this.onConnectionIdle()
  }

  onConnectionIdle(): void {
    if (this.#phase === 'warmup-draining') {
      this.#maybeCompleteWarmup()
    }
  }

  onConnectionError(): void {
    if (this.measurementActive) {
      this.measurement.recordConnectionError()
    }
  }

  onTimeout(): void {
    if (this.measurementActive) {
      this.measurement.recordTimeout()
    }
  }

  onProtocolError(): void {
    if (this.measurementActive) {
      this.measurement.recordProtocolError()
    }
  }

  onScheduledOperation(lagMs: number): void {
    if (this.measurementActive) {
      this.measurement.recordScheduleLag(lagMs)
    }
  }

  onBufferedAmount(bytes: number): void {
    if (this.measurementActive) {
      this.measurement.recordBufferedAmount(bytes)
    }
  }

  onBackpressureStarted(): boolean {
    if (!this.measurementActive) {
      return false
    }

    this.measurement.recordBackpressure()

    return true
  }

  onBackpressureEnded(durationMs: number): void {
    this.measurement.recordBackpressureWait(durationMs)
  }

  protected recordAborted(count: number): void {
    if (this.measurementActive && count > 0) {
      this.measurement.recordAborted(count)
    }
  }

  protected canContinueClosedLoop(now: number): boolean {
    return this.closedLoopActive && now < this.#stopAt
  }

  readonly #onMessage = (message: LoadWorkerCommand): void => {
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

  #startPhase(command: Extract<LoadWorkerCommand, { type: 'start' }>): void {
    if (this.#phase !== 'idle') {
      throw new Error(`cannot start ${this.loadName} ${command.phase} phase while worker is ${this.#phase}`)
    }

    if (command.phase === 'measurement') {
      for (const connection of this.#connections) {
        connection.resetPhaseState()
      }

      this.#phase = 'measurement'
      this.measurement.start()
      this.#memoryTimer = setInterval(() => this.measurement.sampleMemory(), this.data.memorySampleMs)
    } else {
      this.#phase = 'warmup'
    }

    this.#running = true
    this.#startedAt = performance.now()
    this.#stopAt = this.#startedAt + command.durationMs
    this.#phaseScheduled = 0
    this.#nextRateConnection = 0

    if (this.data.ratePerSecond === undefined) {
      for (const connection of this.#connections) {
        connection.fillClosedLoop()
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

    const result = this.measurement.finish(this.#startedAt, inFlightAtStop)

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
    const rate = this.data.ratePerSecond

    if (!this.#running || rate === undefined) {
      return
    }

    const now = performance.now()
    const globalExpected = Math.floor(((Math.min(now, this.#stopAt) - this.#startedAt) * rate) / 1000)
    const expected =
      globalExpected <= this.data.rateSequenceOffset
        ? 0
        : Math.floor((globalExpected - 1 - this.data.rateSequenceOffset) / this.data.rateSequenceStride) + 1

    let due = expected - this.#phaseScheduled

    while (due > 0) {
      const sequence = this.data.rateSequenceOffset + 1 + this.#phaseScheduled * this.data.rateSequenceStride
      const scheduledAt = this.#startedAt + (sequence * 1000) / rate
      const connection = this.#nextAvailableRateConnection()

      this.#phaseScheduled++
      due--

      if (connection) {
        connection.scheduleOperation(scheduledAt)
      } else {
        if (this.measurementActive) {
          this.measurement.recordRateDropped(due + 1)
        }

        this.#phaseScheduled += due
        due = 0
      }
    }

    for (const connection of this.#connections) {
      connection.flushScheduledOperations()
    }
  }

  #nextAvailableRateConnection(): Connection | null {
    for (let attempt = 0; attempt < this.#connections.length; attempt++) {
      const index = this.#nextRateConnection

      this.#nextRateConnection = (this.#nextRateConnection + 1) % this.#connections.length

      const connection = this.#connections[index]

      if (connection?.canScheduleOperation()) {
        return connection
      }
    }

    return null
  }

  #post(message: LoadWorkerMessage<Result>): void {
    this.#port.postMessage(message)
  }
}
