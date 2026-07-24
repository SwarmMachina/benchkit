export interface ProcessMemorySamplerOptions {
  sampleMs?: number
}

export interface ProcessMemoryMetric {
  startBytes: number
  endBytes: number
  peakBytes: number
  deltaBytes: number
}

export interface ProcessMemorySummary {
  rss: ProcessMemoryMetric
  heapTotal: ProcessMemoryMetric
  heapUsed: ProcessMemoryMetric
  external: ProcessMemoryMetric
  arrayBuffers: ProcessMemoryMetric
}

type MemoryUsage = ReturnType<typeof process.memoryUsage>
type MemoryKey = keyof ProcessMemorySummary

const MEMORY_KEYS: readonly MemoryKey[] = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']

export class ProcessMemorySampler {
  #running = false
  #timer: ReturnType<typeof setInterval> | null = null
  #start: MemoryUsage | null = null
  #peak: MemoryUsage | null = null

  start({ sampleMs = 50 }: ProcessMemorySamplerOptions = {}): void {
    if (this.#running) {
      return
    }

    if (!Number.isFinite(sampleMs) || sampleMs <= 0) {
      throw new RangeError('sampleMs must be a positive finite number')
    }

    this.#running = true
    this.#start = process.memoryUsage()
    this.#peak = { ...this.#start }
    this.#timer = setInterval(() => this.#sample(), sampleMs)
    this.#timer.unref?.()
  }

  stop(): ProcessMemorySummary | null {
    if (!this.#running || !this.#start || !this.#peak) {
      return null
    }

    this.#running = false

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    const end = this.#sample()
    const start = this.#start
    const peak = this.#peak

    this.#start = null
    this.#peak = null

    return Object.fromEntries(
      MEMORY_KEYS.map((key) => [
        key,
        {
          startBytes: start[key],
          endBytes: end[key],
          peakBytes: peak[key],
          deltaBytes: end[key] - start[key]
        }
      ])
    ) as unknown as ProcessMemorySummary
  }

  #sample(): MemoryUsage {
    const current = process.memoryUsage()

    if (this.#peak) {
      for (const key of MEMORY_KEYS) {
        this.#peak[key] = Math.max(this.#peak[key], current[key])
      }
    }

    return current
  }
}
