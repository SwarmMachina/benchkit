import assert from 'node:assert/strict'
import test from 'node:test'
import { BoundedLatencyRecorder, measureBatch, measureScenario } from '@swarmmachina/benchkit'

test('measureBatch records runtime deltas and nearest-rank latency', async () => {
  let prepared = false

  const result = await measureBatch({
    operations: 4,
    before: () => {
      prepared = true
    },
    run: () => [4, 1, 3, 2]
  })

  assert.equal(prepared, true)
  assert.equal(result.operations, 4)
  assert.ok(result.durationMs >= 0)
  assert.ok(Number.isFinite(result.operationsPerSecond))
  assert.ok(Number.isFinite(result.eluPct))
  assert.deepEqual(result.latencyMs, { p50: 2, p95: 4, p99: 4 })
  assert.deepEqual(result.latencyDetails, {
    algorithm: 'exact-nearest-rank',
    count: 4,
    dropped: 0,
    p97_5Ms: 4,
    maxRelativeErrorPct: 0
  })

  for (const value of Object.values(result.memoryDeltaMiB)) {
    assert.ok(Number.isFinite(value))
  }
})

test('measureBatch validates operation count', async () => {
  await assert.rejects(() => measureBatch({ operations: 0, run: () => [] }), TypeError)
})

test('measureBatch consumes a bounded latency snapshot without retaining raw samples', async () => {
  const recorder = new BoundedLatencyRecorder({ lowestDiscernibleMs: 0.0001 })

  for (const sample of [0.001, 0.01, 0.1, 1, 10]) {
    recorder.record(sample)
  }

  recorder.record(Number.NaN)

  const result = await measureBatch({
    operations: 5,
    memorySampleMs: 1,
    run: () => recorder.snapshot()
  })

  assert.equal(result.latencyDetails.algorithm, 'logarithmic-histogram-nearest-rank')
  assert.equal(result.latencyDetails.count, 5)
  assert.equal(result.latencyDetails.dropped, 1)
  assert.equal(result.latencyDetails.maxRelativeErrorPct, 1)
  assert.ok(result.latencyMs.p99 !== null)
  assert.ok(result.processMemory)
  assert.ok(result.processMemory.rss.peakBytes >= result.processMemory.rss.startBytes)
})

test('measureScenario adds stable scenario dimensions', async () => {
  const result = await measureScenario({
    name: 'request/response',
    connections: 2,
    pipelining: 8,
    operations: 2,
    run: () => [1, 2]
  })

  assert.equal(result.name, 'request/response')
  assert.equal(result.connections, 2)
  assert.equal(result.pipelining, 8)
  await assert.rejects(measureScenario({ name: '', operations: 1, run: () => [1] }), /scenario name/)
})
