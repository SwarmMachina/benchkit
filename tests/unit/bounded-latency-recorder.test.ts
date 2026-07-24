import assert from 'node:assert/strict'
import test from 'node:test'
import { createBoundedLatencyRecorder, quantileNearestRank, type BoundedLatencySummary } from '@swarmmachina/benchkit'

test('bounded recorder approximates nearest-rank percentiles on a realistic distribution', () => {
  const samples = Array.from({ length: 50_000 }, (_, index) => {
    const wave = (Math.sin(index * 0.173) + 1) * 0.35
    const load = (index % 997) / 997

    return 0.08 + wave + load ** 4 * 8
  })

  samples.push(40, 75, 120, 250, 900)

  const recorder = createBoundedLatencyRecorder({
    lowestDiscernibleMs: 0.001,
    highestTrackableMs: 1_000,
    relativeAccuracy: 0.005
  })

  for (const sample of samples) {
    recorder.record(sample)
  }

  const summary = recorder.summary()

  assert.equal(summary.count, samples.length)
  assert.equal(summary.dropped, 0)
  assert.equal(summary.accuracy.maxRelativeErrorPct, 0.5)
  assertApproximateNearestRank(summary, samples, 0.005)
})

test('bounded recorder merges worker snapshots without raw samples', () => {
  const options = {
    lowestDiscernibleMs: 0.01,
    highestTrackableMs: 100,
    relativeAccuracy: 0.01
  }
  const workerA = createBoundedLatencyRecorder(options)
  const workerB = createBoundedLatencyRecorder(options)
  const merged = createBoundedLatencyRecorder(options)
  const direct = createBoundedLatencyRecorder(options)

  for (let value = 1; value <= 10_000; value++) {
    const latency = 0.01 + (value % 400) / 10
    const worker = value % 2 ? workerA : workerB

    worker.record(latency)
    direct.record(latency)
  }

  merged.merge(workerA.snapshot())
  merged.merge(workerB.snapshot())

  assert.deepEqual(merged.summary(), direct.summary())
  assert.ok(workerA.snapshot().counts.length < 2_000)
})

test('bounded recorder reports invalid and out-of-range samples', () => {
  const recorder = createBoundedLatencyRecorder({
    lowestDiscernibleMs: 0.1,
    highestTrackableMs: 10
  })

  for (const value of [0, 0.1, 10, -1, 0.01, 11, Number.NaN]) {
    recorder.record(value)
  }

  const summary = recorder.summary()

  assert.deepEqual(
    {
      ...summary,
      p95Ms: null,
      p97_5Ms: null,
      p99Ms: null
    },
    {
      count: 3,
      dropped: 4,
      outOfRange: 3,
      nonFinite: 1,
      belowRange: 2,
      aboveRange: 1,
      p50Ms: 0.101,
      p95Ms: null,
      p97_5Ms: null,
      p99Ms: null,
      accuracy: {
        algorithm: 'logarithmic-histogram-nearest-rank',
        maxRelativeErrorPct: 1,
        lowestDiscernibleMs: 0.1,
        highestTrackableMs: 10
      }
    }
  )

  for (const value of [summary.p95Ms, summary.p97_5Ms, summary.p99Ms]) {
    assert.ok(value !== null)
    assert.ok(Math.abs(value - 10) / 10 <= 0.01)
  }
})

test('bounded recorder validates configuration and merged snapshots', () => {
  assert.throws(() => createBoundedLatencyRecorder({ relativeAccuracy: 1 }), RangeError)

  const source = createBoundedLatencyRecorder({ highestTrackableMs: 10 })
  const target = createBoundedLatencyRecorder({ highestTrackableMs: 20 })

  assert.throws(() => target.merge(source.snapshot()), /does not match/)

  const invalid = source.snapshot()

  invalid.count++
  assert.throws(() => source.merge(invalid), /does not match its buckets/)
})

function assertApproximateNearestRank(
  summary: BoundedLatencySummary,
  samples: readonly number[],
  relativeAccuracy: number
): void {
  for (const [key, fraction] of [
    ['p50Ms', 0.5],
    ['p95Ms', 0.95],
    ['p97_5Ms', 0.975],
    ['p99Ms', 0.99]
  ] as const) {
    const exact = quantileNearestRank(samples, fraction)
    const approximate = summary[key]

    assert.ok(exact !== null)
    assert.ok(approximate !== null)
    assert.ok(Math.abs(approximate - exact) / exact <= relativeAccuracy + Number.EPSILON * 16)
  }
}
