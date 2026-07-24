export interface BoundedLatencyRecorderOptions {
  lowestDiscernibleMs?: number
  highestTrackableMs?: number
  relativeAccuracy?: number
}

export interface BoundedLatencyRecorderConfig {
  lowestDiscernibleMs: number
  highestTrackableMs: number
  relativeAccuracy: number
}

export interface BoundedLatencySnapshot extends BoundedLatencyRecorderConfig {
  version: 1
  counts: number[]
  zeroCount: number
  count: number
  nonFinite: number
  belowRange: number
  aboveRange: number
}

export interface BoundedLatencySummary {
  count: number
  dropped: number
  outOfRange: number
  nonFinite: number
  belowRange: number
  aboveRange: number
  p50Ms: number | null
  p95Ms: number | null
  p97_5Ms: number | null
  p99Ms: number | null
  accuracy: {
    algorithm: 'logarithmic-histogram-nearest-rank'
    maxRelativeErrorPct: number
    lowestDiscernibleMs: number
    highestTrackableMs: number
  }
}

export interface BoundedLatencyRecorder {
  record(ms: number): void
  merge(snapshot: BoundedLatencySnapshot): void
  snapshot(): BoundedLatencySnapshot
  summary(): BoundedLatencySummary
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

  function summary(): BoundedLatencySummary {
    return {
      count,
      dropped: nonFinite + belowRange + aboveRange,
      outOfRange: belowRange + aboveRange,
      nonFinite,
      belowRange,
      aboveRange,
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
