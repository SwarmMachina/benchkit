import assert from 'node:assert/strict'
import test from 'node:test'
import { ProcessMemoryPeakTracker } from '../../../dist/measurement/process-memory-peak-tracker.js'
import { memoryUsage } from '../../helpers/memory-usage.ts'

test('ProcessMemoryPeakTracker records independent per-metric peaks for one interval', () => {
  const snapshots = [
    memoryUsage({ rss: 10, heapTotal: 20, heapUsed: 30, external: 40, arrayBuffers: 50 }),
    memoryUsage({ rss: 15, heapTotal: 18, heapUsed: 35, external: 38, arrayBuffers: 55 }),
    memoryUsage({ rss: 12, heapTotal: 25, heapUsed: 32, external: 45, arrayBuffers: 52 })
  ]
  const tracker = new ProcessMemoryPeakTracker(() => snapshots.shift()!)

  assert.equal(tracker.stop(), null)
  assert.deepEqual(
    tracker.start(),
    memoryUsage({ rss: 10, heapTotal: 20, heapUsed: 30, external: 40, arrayBuffers: 50 })
  )
  tracker.sample()

  assert.deepEqual(tracker.stop(), {
    start: memoryUsage({ rss: 10, heapTotal: 20, heapUsed: 30, external: 40, arrayBuffers: 50 }),
    end: memoryUsage({ rss: 12, heapTotal: 25, heapUsed: 32, external: 45, arrayBuffers: 52 }),
    peak: memoryUsage({ rss: 15, heapTotal: 25, heapUsed: 35, external: 45, arrayBuffers: 55 })
  })
  assert.equal(tracker.stop(), null)
})

test('ProcessMemoryPeakTracker resets peaks when a new interval starts', () => {
  const snapshots = [
    memoryUsage({ rss: 100 }),
    memoryUsage({ rss: 150 }),
    memoryUsage({ rss: 20 }),
    memoryUsage({ rss: 25 })
  ]
  const tracker = new ProcessMemoryPeakTracker(() => snapshots.shift()!)

  tracker.start()
  assert.equal(tracker.stop()?.peak.rss, 150)

  tracker.start()
  assert.equal(tracker.stop()?.peak.rss, 25)
})
