import assert from 'node:assert/strict'
import test from 'node:test'
import { forceGc, measureMemoryGrowth } from '@swarmmachina/benchkit'
import { memoryUsage } from '../../helpers/memory-usage.ts'

test('forceGc validates and executes bounded collection cycles', async () => {
  let collections = 0

  await forceGc({
    cycles: 3,
    settleMs: 0,
    collectGarbage: () => {
      collections++
    }
  })

  assert.equal(collections, 3)
  await assert.rejects(forceGc({ cycles: 0, collectGarbage: () => {} }), /cycles/)
})

test('measureMemoryGrowth reports retained deltas without enforcing policy', async () => {
  const snapshots = [
    memoryUsage({ rss: 100, heapUsed: 20, arrayBuffers: 5 }),
    memoryUsage({ rss: 130, heapUsed: 24, arrayBuffers: 3 })
  ]

  let runs = 0

  const result = await measureMemoryGrowth({
    warmup: 2,
    iterations: 3,
    run: () => {
      runs++
    },
    gc: { cycles: 1, settleMs: 0, collectGarbage: () => {} },
    memoryUsage: () => snapshots.shift()!
  })

  assert.equal(runs, 5)
  assert.equal(result.rss.deltaBytes, 30)
  assert.equal(result.heapUsed.deltaBytes, 4)
  assert.equal(result.arrayBuffers.deltaBytes, -2)
  assert.equal(result.warmup, 2)
  assert.equal(result.iterations, 3)
})
