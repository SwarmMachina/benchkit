import assert from 'node:assert/strict'
import test from 'node:test'
import { V8HeapAllocationSampler, sampleV8HeapAllocations, sampledAllocationBytes } from '@swarmmachina/benchkit'

test('sampledAllocationBytes sums an allocation profile iteratively', () => {
  assert.equal(
    sampledAllocationBytes({
      head: {
        selfSize: 2,
        children: [
          { selfSize: 3, children: [] },
          { selfSize: 5, children: [{ selfSize: 7, children: [] }] }
        ]
      }
    }),
    17
  )
})

test('sampleV8HeapAllocations returns the profile and consumer value', async () => {
  const result = await sampleV8HeapAllocations(
    () => {
      const values = Array.from({ length: 2_000 }, (_, index) => ({ index, payload: `value-${index}` }))

      return values.length
    },
    { samplingIntervalBytes: 128, includeCollectedObjects: true }
  )

  assert.equal(result.value, 2_000)
  assert.ok(result.profile.head)
  assert.ok(Number.isFinite(result.sampledAllocationBytes))
  assert.ok(result.sampledAllocationBytes >= 0)
})

test('V8HeapAllocationSampler enforces lifecycle and cleanup', async () => {
  const sampler = new V8HeapAllocationSampler({ samplingIntervalBytes: 1024 })

  await assert.rejects(() => sampler.stop(), /not running/)
  await sampler.start()
  await assert.rejects(() => sampler.start(), /already running/)

  const result = await sampler.stop()

  assert.ok(result.profile.head)
  await sampler.dispose()
  await sampler.dispose()
  await assert.rejects(() => sampler.start(), /disposed/)
})

test('V8HeapAllocationSampler validates options and profiles', () => {
  assert.throws(() => new V8HeapAllocationSampler({ samplingIntervalBytes: 0 }), RangeError)
  assert.throws(() => sampledAllocationBytes({ head: { selfSize: Number.NaN, children: [] } }), /invalid node/)
})
