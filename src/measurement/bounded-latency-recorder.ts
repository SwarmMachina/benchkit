import { isNonNegativeSafeInteger, isPositiveFiniteNumber } from '../validation/predicates.js'

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

const DEFAULT_LOWEST_MS = 0.001
const DEFAULT_HIGHEST_MS = 60_000
const DEFAULT_RELATIVE_ACCURACY = 0.01
const MAX_BUCKETS = 1_000_000

/** Mutable bounded latency histogram with mergeable snapshots. */
export class BoundedLatencyRecorder {
  readonly #config: BoundedLatencyRecorderConfig
  readonly #base: number
  readonly #logBase: number
  readonly #counts: Float64Array
  #zeroCount = 0
  #count = 0
  #nonFinite = 0
  #belowRange = 0
  #aboveRange = 0

  /** Allocates histogram storage for the validated recorder configuration. */
  constructor(options: BoundedLatencyRecorderOptions = {}) {
    this.#config = validateConfig(options)
    this.#base = 1 + 2 * this.#config.relativeAccuracy
    this.#logBase = Math.log(this.#base)

    const bucketCount =
      Math.ceil(Math.log(this.#config.highestTrackableMs / this.#config.lowestDiscernibleMs) / this.#logBase) + 1

    if (bucketCount > MAX_BUCKETS) {
      throw new RangeError(`latency recorder configuration requires ${bucketCount} buckets; maximum is ${MAX_BUCKETS}`)
    }

    this.#counts = new Float64Array(bucketCount)
  }

  /** Records one latency observation in milliseconds. */
  record(ms: number): void {
    if (!Number.isFinite(ms)) {
      this.#nonFinite++

      return
    }

    if (ms === 0) {
      this.#zeroCount++
      this.#count++

      return
    }

    if (ms < this.#config.lowestDiscernibleMs) {
      this.#belowRange++

      return
    }

    if (ms > this.#config.highestTrackableMs) {
      this.#aboveRange++

      return
    }

    const index = Math.min(
      this.#counts.length - 1,
      Math.floor(Math.log(ms / this.#config.lowestDiscernibleMs) / this.#logBase)
    )

    this.#counts[index] = (this.#counts[index] ?? 0) + 1
    this.#count++
  }

  /** Merges a snapshot created with identical histogram configuration. */
  merge(value: BoundedLatencySnapshot): void {
    validateSnapshot(value, this.#config, this.#counts.length)

    for (let index = 0; index < this.#counts.length; index++) {
      this.#counts[index] = (this.#counts[index] ?? 0) + (value.counts[index] ?? 0)
    }

    this.#zeroCount += value.zeroCount
    this.#count += value.count
    this.#nonFinite += value.nonFinite
    this.#belowRange += value.belowRange
    this.#aboveRange += value.aboveRange
  }

  /** Returns a detached serializable copy of the current histogram state. */
  snapshot(): BoundedLatencySnapshot {
    return {
      version: 1,
      ...this.#config,
      counts: Array.from(this.#counts),
      zeroCount: this.#zeroCount,
      count: this.#count,
      nonFinite: this.#nonFinite,
      belowRange: this.#belowRange,
      aboveRange: this.#aboveRange
    }
  }

  /** Summarizes the current histogram without resetting it. */
  summary(): BoundedLatencySummary {
    return {
      count: this.#count,
      dropped: this.#nonFinite + this.#belowRange + this.#aboveRange,
      outOfRange: this.#belowRange + this.#aboveRange,
      nonFinite: this.#nonFinite,
      belowRange: this.#belowRange,
      aboveRange: this.#aboveRange,
      averageMs: this.#average(),
      p50Ms: this.#quantile(0.5),
      p95Ms: this.#quantile(0.95),
      p97_5Ms: this.#quantile(0.975),
      p99Ms: this.#quantile(0.99),
      accuracy: {
        algorithm: 'logarithmic-histogram-nearest-rank',
        maxRelativeErrorPct: this.#config.relativeAccuracy * 100,
        lowestDiscernibleMs: this.#config.lowestDiscernibleMs,
        highestTrackableMs: this.#config.highestTrackableMs
      }
    }
  }

  /** Removes all observations while retaining allocated histogram storage. */
  reset(): void {
    this.#counts.fill(0)
    this.#zeroCount = 0
    this.#count = 0
    this.#nonFinite = 0
    this.#belowRange = 0
    this.#aboveRange = 0
  }

  #quantile(fraction: number): number | null {
    if (!this.#count) {
      return null
    }

    const rank = Math.max(1, Math.ceil(this.#count * fraction))

    if (rank <= this.#zeroCount) {
      return 0
    }

    let cumulative = this.#zeroCount

    for (let index = 0; index < this.#counts.length; index++) {
      cumulative += this.#counts[index] ?? 0

      if (cumulative >= rank) {
        const lower = this.#config.lowestDiscernibleMs * this.#base ** index
        const midpoint = lower * (1 + this.#config.relativeAccuracy)

        return Math.min(this.#config.highestTrackableMs, midpoint)
      }
    }

    return this.#config.highestTrackableMs
  }

  #average(): number | null {
    if (!this.#count) {
      return null
    }

    let totalMs = 0

    for (let index = 0; index < this.#counts.length; index++) {
      const bucketCount = this.#counts[index] ?? 0

      if (bucketCount === 0) {
        continue
      }

      const lower = this.#config.lowestDiscernibleMs * this.#base ** index
      const midpoint = Math.min(this.#config.highestTrackableMs, lower * (1 + this.#config.relativeAccuracy))

      totalMs += midpoint * bucketCount
    }

    return totalMs / this.#count
  }
}

export function summarizeBoundedLatencySnapshot(snapshot: BoundedLatencySnapshot): BoundedLatencySummary {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new TypeError('snapshot must be a bounded latency snapshot')
  }

  const recorder = new BoundedLatencyRecorder({
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

  if (!isPositiveFiniteNumber(config.lowestDiscernibleMs)) {
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

  if (counters.some((value) => !isNonNegativeSafeInteger(value))) {
    throw new TypeError('snapshot counters must be non-negative safe integers')
  }

  const recorded = snapshot.zeroCount + snapshot.counts.reduce((total, value) => total + value, 0)

  if (recorded !== snapshot.count) {
    throw new RangeError('snapshot count does not match its buckets')
  }
}
