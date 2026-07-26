export type ProcessMemoryUsage = ReturnType<typeof process.memoryUsage>

export interface ProcessMemoryPeakInterval {
  start: ProcessMemoryUsage
  end: ProcessMemoryUsage
  peak: ProcessMemoryUsage
}

const MEMORY_KEYS: readonly (keyof ProcessMemoryUsage)[] = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']

export class ProcessMemoryPeakTracker {
  readonly #memoryUsage: () => ProcessMemoryUsage

  #start: ProcessMemoryUsage | null = null
  #peak: ProcessMemoryUsage | null = null

  constructor(memoryUsage: () => ProcessMemoryUsage = process.memoryUsage) {
    this.#memoryUsage = memoryUsage
  }

  start(): ProcessMemoryUsage {
    const current = this.#memoryUsage()

    this.#start = current
    this.#peak = { ...current }

    return current
  }

  sample(): ProcessMemoryUsage {
    const current = this.#memoryUsage()

    if (this.#peak) {
      for (const key of MEMORY_KEYS) {
        this.#peak[key] = Math.max(this.#peak[key], current[key])
      }
    }

    return current
  }

  stop(): ProcessMemoryPeakInterval | null {
    if (!this.#start || !this.#peak) {
      return null
    }

    const end = this.sample()
    const interval = {
      start: this.#start,
      end,
      peak: this.#peak
    }

    this.#start = null
    this.#peak = null

    return interval
  }
}
