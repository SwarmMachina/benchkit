/** Configuration accepted when creating a bounded latency recorder. */
export interface BoundedLatencyRecorderOptions {
  /**
   * Smallest non-zero latency retained by the histogram, in milliseconds.
   * @default `0.001`
   */
  lowestDiscernibleMs?: number

  /**
   * Largest latency retained by the histogram, in milliseconds.
   * @default `60_000`
   */
  highestTrackableMs?: number

  /**
   * Maximum relative value error expressed as a fraction.
   * @default `0.01`
   */
  relativeAccuracy?: number
}

/** Normalized immutable configuration of a bounded latency recorder. */
export interface BoundedLatencyRecorderConfig {
  /** Smallest retained non-zero latency, in milliseconds. */
  lowestDiscernibleMs: number

  /** Largest retained latency, in milliseconds. */
  highestTrackableMs: number

  /** Maximum relative value error expressed as a fraction. */
  relativeAccuracy: number
}

/** Serializable and mergeable bounded latency histogram state. */
export interface BoundedLatencySnapshot extends BoundedLatencyRecorderConfig {
  /** Snapshot schema version. */
  version: 1

  /** Observation counts indexed by logarithmic bucket. */
  counts: number[]

  /** Number of exact zero-millisecond observations. */
  zeroCount: number

  /** Number of accepted observations, including exact zero values. */
  count: number

  /** Number of rejected `NaN` or infinite observations. */
  nonFinite: number

  /** Number of rejected observations below the configured range. */
  belowRange: number

  /** Number of rejected observations above the configured range. */
  aboveRange: number
}

/** Statistical summary derived from a bounded latency histogram. */
export interface BoundedLatencySummary {
  /** Number of accepted observations. */
  count: number

  /** Total rejected observations. */
  dropped: number

  /** Rejected observations outside the configured numeric range. */
  outOfRange: number

  /** Rejected `NaN` or infinite observations. */
  nonFinite: number

  /** Rejected observations below the configured range. */
  belowRange: number

  /** Rejected observations above the configured range. */
  aboveRange: number

  /** Approximate arithmetic mean in milliseconds, or `null` when empty. */
  averageMs: number | null

  /** Approximate nearest-rank 50th percentile in milliseconds, or `null` when empty. */
  p50Ms: number | null

  /** Approximate nearest-rank 95th percentile in milliseconds, or `null` when empty. */
  p95Ms: number | null

  /** Approximate nearest-rank 97.5th percentile in milliseconds, or `null` when empty. */
  p97_5Ms: number | null

  /** Approximate nearest-rank 99th percentile in milliseconds, or `null` when empty. */
  p99Ms: number | null

  /** Algorithm and configured error bounds for the reported values. */
  accuracy: {
    /** Histogram and quantile algorithm identifier. */
    algorithm: 'logarithmic-histogram-nearest-rank'

    /** Maximum relative value error, expressed as a percentage. */
    maxRelativeErrorPct: number

    /** Smallest retained non-zero latency, in milliseconds. */
    lowestDiscernibleMs: number

    /** Largest retained latency, in milliseconds. */
    highestTrackableMs: number
  }
}

/** Mutable bounded latency recorder with mergeable snapshots. */
export interface BoundedLatencyRecorder {
  /** Records one latency observation in milliseconds. */
  record(ms: number): void

  /** Merges a snapshot created with identical histogram configuration. */
  merge(snapshot: BoundedLatencySnapshot): void

  /** Returns a detached serializable copy of the current histogram state. */
  snapshot(): BoundedLatencySnapshot

  /** Summarizes the current histogram without resetting it. */
  summary(): BoundedLatencySummary

  /** Removes all observations while retaining allocated histogram storage. */
  reset(): void
}

const DEFAULT_LOWEST_MS = 0.001
const DEFAULT_HIGHEST_MS = 60_000
const DEFAULT_RELATIVE_ACCURACY = 0.01
const MAX_BUCKETS = 1_000_000

export function createBoundedLatencyRecorder(options: BoundedLatencyRecorderOptions = {}): BoundedLatencyRecorder {
  const config = validateConfig(options)
  const base = 1 + 2 * config.relativeAccuracy
  const logBase = Math.log(base)
  const bucketCount = Math.ceil(Math.log(config.highestTrackableMs / config.lowestDiscernibleMs) / logBase) + 1

  if (bucketCount > MAX_BUCKETS) {
    throw new RangeError(`latency recorder configuration requires ${bucketCount} buckets; maximum is ${MAX_BUCKETS}`)
  }

  const counts = new Float64Array(bucketCount)

  let zeroCount = 0
  let count = 0
  let nonFinite = 0
  let belowRange = 0
  let aboveRange = 0

  function record(ms: number): void {
    if (!Number.isFinite(ms)) {
      nonFinite++

      return
    }

    if (ms === 0) {
      zeroCount++
      count++

      return
    }

    if (ms < config.lowestDiscernibleMs) {
      belowRange++

      return
    }

    if (ms > config.highestTrackableMs) {
      aboveRange++

      return
    }

    const index = Math.min(counts.length - 1, Math.floor(Math.log(ms / config.lowestDiscernibleMs) / logBase))

    counts[index] = (counts[index] ?? 0) + 1
    count++
  }

  function merge(value: BoundedLatencySnapshot): void {
    validateSnapshot(value, config, counts.length)

    for (let index = 0; index < counts.length; index++) {
      counts[index] = (counts[index] ?? 0) + (value.counts[index] ?? 0)
    }

    zeroCount += value.zeroCount
    count += value.count
    nonFinite += value.nonFinite
    belowRange += value.belowRange
    aboveRange += value.aboveRange
  }

  function snapshot(): BoundedLatencySnapshot {
    return {
      version: 1,
      ...config,
      counts: Array.from(counts),
      zeroCount,
      count,
      nonFinite,
      belowRange,
      aboveRange
    }
  }

  function quantile(fraction: number): number | null {
    if (!count) {
      return null
    }

    const rank = Math.max(1, Math.ceil(count * fraction))

    if (rank <= zeroCount) {
      return 0
    }

    let cumulative = zeroCount

    for (let index = 0; index < counts.length; index++) {
      cumulative += counts[index] ?? 0

      if (cumulative >= rank) {
        const lower = config.lowestDiscernibleMs * base ** index
        const midpoint = lower * (1 + config.relativeAccuracy)

        return Math.min(config.highestTrackableMs, midpoint)
      }
    }

    return config.highestTrackableMs
  }

  function average(): number | null {
    if (!count) {
      return null
    }

    let totalMs = 0

    for (let index = 0; index < counts.length; index++) {
      const bucketCount = counts[index] ?? 0

      if (bucketCount === 0) {
        continue
      }

      const lower = config.lowestDiscernibleMs * base ** index
      const midpoint = Math.min(config.highestTrackableMs, lower * (1 + config.relativeAccuracy))

      totalMs += midpoint * bucketCount
    }

    return totalMs / count
  }

  function summary(): BoundedLatencySummary {
    return {
      count,
      dropped: nonFinite + belowRange + aboveRange,
      outOfRange: belowRange + aboveRange,
      nonFinite,
      belowRange,
      aboveRange,
      averageMs: average(),
      p50Ms: quantile(0.5),
      p95Ms: quantile(0.95),
      p97_5Ms: quantile(0.975),
      p99Ms: quantile(0.99),
      accuracy: {
        algorithm: 'logarithmic-histogram-nearest-rank',
        maxRelativeErrorPct: config.relativeAccuracy * 100,
        lowestDiscernibleMs: config.lowestDiscernibleMs,
        highestTrackableMs: config.highestTrackableMs
      }
    }
  }

  function reset(): void {
    counts.fill(0)
    zeroCount = 0
    count = 0
    nonFinite = 0
    belowRange = 0
    aboveRange = 0
  }

  return { record, merge, snapshot, summary, reset }
}

export function summarizeBoundedLatencySnapshot(snapshot: BoundedLatencySnapshot): BoundedLatencySummary {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('snapshot must be a bounded latency snapshot')
  }

  const recorder = createBoundedLatencyRecorder({
    lowestDiscernibleMs: snapshot.lowestDiscernibleMs,
    highestTrackableMs: snapshot.highestTrackableMs,
    relativeAccuracy: snapshot.relativeAccuracy
  })

  recorder.merge(snapshot)

  return recorder.summary()
}

function validateConfig(options: BoundedLatencyRecorderOptions): BoundedLatencyRecorderConfig {
  const config = {
    lowestDiscernibleMs: options.lowestDiscernibleMs ?? DEFAULT_LOWEST_MS,
    highestTrackableMs: options.highestTrackableMs ?? DEFAULT_HIGHEST_MS,
    relativeAccuracy: options.relativeAccuracy ?? DEFAULT_RELATIVE_ACCURACY
  }

  if (!Number.isFinite(config.lowestDiscernibleMs) || config.lowestDiscernibleMs <= 0) {
    throw new RangeError('lowestDiscernibleMs must be a positive finite number')
  }

  if (!Number.isFinite(config.highestTrackableMs) || config.highestTrackableMs < config.lowestDiscernibleMs) {
    throw new RangeError('highestTrackableMs must be finite and at least lowestDiscernibleMs')
  }

  if (!Number.isFinite(config.relativeAccuracy) || config.relativeAccuracy <= 0 || config.relativeAccuracy >= 1) {
    throw new RangeError('relativeAccuracy must be a finite number between 0 and 1')
  }

  return config
}

function validateSnapshot(
  snapshot: BoundedLatencySnapshot,
  config: BoundedLatencyRecorderConfig,
  bucketCount: number
): void {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.version !== 1) {
    throw new TypeError('snapshot must be a version 1 bounded latency snapshot')
  }

  for (const key of ['lowestDiscernibleMs', 'highestTrackableMs', 'relativeAccuracy'] as const) {
    if (snapshot[key] !== config[key]) {
      throw new RangeError(`snapshot ${key} does not match recorder configuration`)
    }
  }

  if (!Array.isArray(snapshot.counts) || snapshot.counts.length !== bucketCount) {
    throw new RangeError('snapshot bucket count does not match recorder configuration')
  }

  const counters = [
    snapshot.zeroCount,
    snapshot.count,
    snapshot.nonFinite,
    snapshot.belowRange,
    snapshot.aboveRange,
    ...snapshot.counts
  ]

  if (counters.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError('snapshot counters must be non-negative safe integers')
  }

  const recorded = snapshot.zeroCount + snapshot.counts.reduce((total, value) => total + value, 0)

  if (recorded !== snapshot.count) {
    throw new RangeError('snapshot count does not match its buckets')
  }
}
