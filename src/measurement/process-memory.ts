/** Options used when starting a process-memory sampler. */
export interface ProcessMemorySamplerOptions {
  /**
   * Peak-sampling interval in milliseconds.
   * @default `50`
   */
  sampleMs?: number
}

/** Start, end, peak, and delta values for one memory category. */
export interface ProcessMemoryMetric {
  /** Bytes observed when sampling started. */
  startBytes: number

  /** Bytes observed when sampling stopped. */
  endBytes: number

  /** Largest sampled value in bytes, including start and end snapshots. */
  peakBytes: number

  /** `endBytes - startBytes`; negative values are preserved. */
  deltaBytes: number
}

/** Process-memory measurements grouped by Node.js memory category. */
export interface ProcessMemorySummary {
  /** Resident set size measurements. */
  rss: ProcessMemoryMetric

  /** V8 heap capacity measurements. */
  heapTotal: ProcessMemoryMetric

  /** Used V8 heap measurements. */
  heapUsed: ProcessMemoryMetric

  /** V8 external memory measurements. */
  external: ProcessMemoryMetric

  /** `ArrayBuffer` memory measurements. */
  arrayBuffers: ProcessMemoryMetric
}

type MemoryUsage = ReturnType<typeof process.memoryUsage>
type MemoryKey = keyof ProcessMemorySummary

const MEMORY_KEYS: readonly MemoryKey[] = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']

/** Samples process-memory peaks over an explicit start/stop interval. */
export class ProcessMemorySampler {
  #running = false
  #timer: ReturnType<typeof setInterval> | null = null
  #start: MemoryUsage | null = null
  #peak: MemoryUsage | null = null

  /**
   * Starts sampling unless already running.
   *
   * Starting a running sampler is a no-op.
   */
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

  /**
   * Stops sampling and returns the interval summary.
   *
   * Returns `null` when the sampler is not running.
   */
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
