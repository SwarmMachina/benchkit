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

/**
 * Legacy latency recorder that retains at most the latest 100,000 samples.
 *
 * Prefer `BoundedLatencyRecorder` when snapshots must be merged across workers.
 */
export interface LatencyRecorder {
  /** Records one latency observation in milliseconds. */
  record(ms: number): void

  /** Returns latency statistics using `messages` as the average denominator. */
  summary(messages: number): LatencySummary
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
export default function createLatencyRecorder(): LatencyRecorder {
  const lat = new Float64Array(MAX_LAT_SAMPLES)

  let sum = 0
  let count = 0
  let idx = 0

  return {
    record(ms) {
      sum += ms
      lat[idx] = ms
      idx = (idx + 1) % MAX_LAT_SAMPLES

      if (count < MAX_LAT_SAMPLES) {
        count++
      }
    },
    summary(messages) {
      return {
        avgMs: messages ? sum / messages : null,
        p95Ms: percentileFromBuffer(lat, count, 95),
        p97_5Ms: percentileFromBuffer(lat, count, 97.5),
        p99Ms: percentileFromBuffer(lat, count, 99)
      }
    }
  }
}
