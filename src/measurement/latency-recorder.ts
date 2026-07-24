const MAX_LAT_SAMPLES = 100_000

/** Summary produced by the legacy bounded-sample latency recorder. */
export interface LatencySummary {
  /** Arithmetic mean in milliseconds, or `null` when `messages` is zero. */
  avgMs: number | null

  /** 95th percentile of retained samples in milliseconds, or `null` when empty. */
  p95Ms: number | null

  /** 97.5th percentile of retained samples in milliseconds, or `null` when empty. */
  p97_5Ms: number | null

  /** 99th percentile of retained samples in milliseconds, or `null` when empty. */
  p99Ms: number | null
}

function percentileFromBuffer(buffer: Float64Array, sampleCount: number, percentile: number): number | null {
  if (!sampleCount) {
    return null
  }

  const sorted = Float64Array.prototype.slice.call(buffer, 0, sampleCount).sort()
  const idx = Math.min(sampleCount - 1, Math.floor((percentile / 100) * sampleCount))

  return sorted[idx] ?? null
}

// Running sum drives the average; the bounded ring buffer (last MAX_LAT_SAMPLES)
// drives the percentiles.
/**
 * Legacy latency recorder that retains at most the latest 100,000 samples.
 *
 * Prefer `BoundedLatencyRecorder` when snapshots must be merged across workers.
 */
export default class LatencyRecorder {
  readonly #latencies = new Float64Array(MAX_LAT_SAMPLES)
  #sum = 0
  #count = 0
  #index = 0

  /** Records one latency observation in milliseconds. */
  record(ms: number): void {
    this.#sum += ms
    this.#latencies[this.#index] = ms
    this.#index = (this.#index + 1) % MAX_LAT_SAMPLES

    if (this.#count < MAX_LAT_SAMPLES) {
      this.#count++
    }
  }

  /** Returns latency statistics using `messages` as the average denominator. */
  summary(messages: number): LatencySummary {
    return {
      avgMs: messages ? this.#sum / messages : null,
      p95Ms: percentileFromBuffer(this.#latencies, this.#count, 95),
      p97_5Ms: percentileFromBuffer(this.#latencies, this.#count, 97.5),
      p99Ms: percentileFromBuffer(this.#latencies, this.#count, 99)
    }
  }
}
