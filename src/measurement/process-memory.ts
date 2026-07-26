import { isPositiveFiniteNumber } from '../validation/predicates.js'
import { ProcessMemoryPeakTracker } from './process-memory-peak-tracker.js'

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

type MemoryKey = keyof ProcessMemorySummary

const MEMORY_KEYS: readonly MemoryKey[] = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']

/** Samples process-memory peaks over an explicit start/stop interval. */
export class ProcessMemorySampler {
  readonly #memory = new ProcessMemoryPeakTracker()

  #running = false
  #timer: ReturnType<typeof setInterval> | null = null

  /**
   * Starts sampling unless already running.
   *
   * Starting a running sampler is a no-op.
   */
  start({ sampleMs = 50 }: ProcessMemorySamplerOptions = {}): void {
    if (this.#running) {
      return
    }

    if (!isPositiveFiniteNumber(sampleMs)) {
      throw new RangeError('sampleMs must be a positive finite number')
    }

    this.#running = true
    this.#memory.start()
    this.#timer = setInterval(() => this.#memory.sample(), sampleMs)
    this.#timer.unref?.()
  }

  /**
   * Stops sampling and returns the interval summary.
   *
   * Returns `null` when the sampler is not running.
   */
  stop(): ProcessMemorySummary | null {
    if (!this.#running) {
      return null
    }

    this.#running = false

    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }

    const memory = this.#memory.stop()

    if (!memory) {
      throw new Error('process memory peak tracker did not produce a result')
    }

    return Object.fromEntries(
      MEMORY_KEYS.map((key) => [
        key,
        {
          startBytes: memory.start[key],
          endBytes: memory.end[key],
          peakBytes: memory.peak[key],
          deltaBytes: memory.end[key] - memory.start[key]
        }
      ])
    ) as unknown as ProcessMemorySummary
  }
}
