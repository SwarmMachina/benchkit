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
