export class TimestampQueue {
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
