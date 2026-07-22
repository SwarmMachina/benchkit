import assert from 'node:assert/strict'
import test from 'node:test'
import { measureBatch } from '@swarmmachina/benchkit'

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

  for (const value of Object.values(result.memoryDeltaMiB)) {
    assert.ok(Number.isFinite(value))
  }
})

test('measureBatch validates operation count', async () => {
  await assert.rejects(() => measureBatch({ operations: 0, run: () => [] }), TypeError)
})
