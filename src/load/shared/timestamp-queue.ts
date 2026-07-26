export interface TimestampQueueOptions {
  trackTimeouts?: boolean
}

export class TimestampQueue {
  readonly #latencyStarts: Float64Array
  readonly #timeoutStarts: Float64Array | null

  #head = 0
  #size = 0

  constructor(capacity: number, { trackTimeouts = false }: TimestampQueueOptions = {}) {
    this.#latencyStarts = new Float64Array(capacity)
    this.#timeoutStarts = trackTimeouts ? new Float64Array(capacity) : null
  }

  get size(): number {
    return this.#size
  }

  peekTimeoutStart(): number | null {
    if (this.#size === 0) {
      return null
    }

    return this.#timeoutStarts?.[this.#head] ?? this.#latencyStarts[this.#head] ?? 0
  }

  push(latencyStart: number, timeoutStart = latencyStart): void {
    if (this.#size === this.#latencyStarts.length) {
      throw new Error('load timestamp queue overflow')
    }

    const index = (this.#head + this.#size) % this.#latencyStarts.length

    this.#latencyStarts[index] = latencyStart

    if (this.#timeoutStarts) {
      this.#timeoutStarts[index] = timeoutStart
    }

    this.#size++
  }

  shift(): number | null {
    if (this.#size === 0) {
      return null
    }

    const value = this.#latencyStarts[this.#head] ?? 0

    this.#head = (this.#head + 1) % this.#latencyStarts.length
    this.#size--

    return value
  }

  clear(): void {
    this.#head = 0
    this.#size = 0
  }
}
