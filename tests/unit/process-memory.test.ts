import assert from 'node:assert/strict'
import test from 'node:test'
import { ProcessMemorySampler } from '@swarmmachina/benchkit'

test('ProcessMemorySampler reports start, end, peak and delta bytes for every process metric', () => {
  const sampler = new ProcessMemorySampler()

  sampler.start({ sampleMs: 5 })

  const allocation = Buffer.alloc(256 * 1024)
  const result = sampler.stop()

  assert.ok(result)

  for (const metric of Object.values(result)) {
    assert.ok(Number.isFinite(metric.startBytes))
    assert.ok(Number.isFinite(metric.endBytes))
    assert.ok(Number.isFinite(metric.peakBytes))
    assert.equal(metric.deltaBytes, metric.endBytes - metric.startBytes)
    assert.ok(metric.peakBytes >= metric.startBytes)
    assert.ok(metric.peakBytes >= metric.endBytes)
  }

  assert.equal(allocation.byteLength, 256 * 1024)
  assert.equal(sampler.stop(), null)
})

test('ProcessMemorySampler validates sampling interval', () => {
  const sampler = new ProcessMemorySampler()

  assert.throws(() => sampler.start({ sampleMs: 0 }), RangeError)
})
