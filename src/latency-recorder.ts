const MAX_LAT_SAMPLES = 100_000

export interface LatencySummary {
  avgMs: number | null
  p95Ms: number | null
  p97_5Ms: number | null
  p99Ms: number | null
}

export interface LatencyRecorder {
  record(ms: number): void
  summary(messages: number): LatencySummary
}

function percentile(buf: Float64Array, count: number, p: number): number | null {
  if (!count) {
    return null
  }

  const sorted = Float64Array.prototype.slice.call(buf, 0, count).sort()
  const idx = Math.min(count - 1, Math.floor((p / 100) * count))

  return sorted[idx]
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
        p95Ms: percentile(lat, count, 95),
        p97_5Ms: percentile(lat, count, 97.5),
        p99Ms: percentile(lat, count, 99)
      }
    }
  }
}
