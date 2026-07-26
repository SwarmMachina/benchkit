import { performance } from 'node:perf_hooks'

export interface LoadConnectionOwner {
  onBackpressureStarted(): boolean
  onBackpressureEnded(durationMs: number): void
}

export abstract class LoadConnection {
  readonly #owner: LoadConnectionOwner

  #backpressured = false
  #backpressureMeasured = false
  #backpressureStartedAt = 0

  protected constructor(owner: LoadConnectionOwner) {
    this.#owner = owner
  }

  abstract get inFlight(): number

  abstract connect(): void
  abstract fillClosedLoop(): void
  abstract canScheduleOperation(): boolean
  abstract scheduleOperation(scheduledAt: number): void
  abstract resetPhaseState(): void
  abstract stop(): void

  flushScheduledOperations(): void {}

  protected get backpressured(): boolean {
    return this.#backpressured
  }

  protected beginBackpressure(): boolean {
    if (this.#backpressured) {
      return false
    }

    this.#backpressured = true
    this.#backpressureMeasured = this.#owner.onBackpressureStarted()
    this.#backpressureStartedAt = performance.now()

    return true
  }

  protected finishBackpressure(): boolean {
    if (!this.#backpressured) {
      return false
    }

    if (this.#backpressureMeasured) {
      this.#owner.onBackpressureEnded(performance.now() - this.#backpressureStartedAt)
    }

    this.#backpressured = false
    this.#backpressureMeasured = false
    this.#backpressureStartedAt = 0

    return true
  }
}
