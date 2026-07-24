import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePerfCounters, parsePerfStat } from '@swarmmachina/benchkit'

test('parsePerfStat parses perf stat -x, counters and preserves unavailable values', () => {
  const counters = parsePerfStat(`# started on Fri
1000000,,cycles,5000,100.00
250000,,instructions,5000,100.00
<not supported>,,cache-misses,5000,100.00
<not counted>,,branch-misses,5000,0.00
`)

  assert.deepEqual(counters, [
    { event: 'cycles', value: 1_000_000, unit: null, status: 'counted', runtime: 5_000, runningPct: 100 },
    { event: 'instructions', value: 250_000, unit: null, status: 'counted', runtime: 5_000, runningPct: 100 },
    {
      event: 'cache-misses',
      value: null,
      unit: null,
      status: 'not-supported',
      runtime: 5_000,
      runningPct: 100
    },
    {
      event: 'branch-misses',
      value: null,
      unit: null,
      status: 'not-counted',
      runtime: 5_000,
      runningPct: 0
    }
  ])

  assert.deepEqual(
    normalizePerfCounters(counters, 100).map(({ event, perOperation }) => ({ event, perOperation })),
    [
      { event: 'cycles', perOperation: 10_000 },
      { event: 'instructions', perOperation: 2_500 },
      { event: 'cache-misses', perOperation: null },
      { event: 'branch-misses', perOperation: null }
    ]
  )
})

test('perf stat helpers reject malformed input and operation counts', () => {
  assert.throws(() => parsePerfStat('broken'), /invalid perf stat line/)
  assert.throws(() => parsePerfStat('NaN,,cycles'), /must be finite/)
  assert.throws(() => normalizePerfCounters([], 0), RangeError)
})
