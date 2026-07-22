import assert from 'node:assert/strict'
import test from 'node:test'
import { distribution, metricMedians, percentDelta, quantileLinear, quantileNearestRank } from '@swarmmachina/benchkit'

test('quantile algorithms are explicit and do not mutate input', () => {
  const values = [4, 1, 3, 2]

  assert.equal(quantileLinear(values, 0.25), 1.75)
  assert.equal(quantileNearestRank(values, 0.5), 2)
  assert.deepEqual(values, [4, 1, 3, 2])
})

test('quantiles filter non-finite values and validate the quantile', () => {
  assert.equal(quantileLinear([Number.NaN, null, 10], 0.5), 10)
  assert.equal(quantileNearestRank([], 0.95), null)
  assert.throws(() => quantileLinear([1], -0.1), RangeError)
  assert.throws(() => quantileNearestRank([1], 1.1), RangeError)
})

test('distribution keeps finite samples and reports linear quartiles', () => {
  assert.deepEqual(distribution([4, null, 1, Number.NaN, 3, 2]), {
    median: 2.5,
    q1: 1.75,
    q3: 3.25,
    values: [4, 1, 3, 2]
  })
})

test('percentDelta keeps candidate-reference sign semantics', () => {
  assert.equal(percentDelta(120, 100), 20)
  assert.equal(percentDelta(80, 100), -20)
  assert.equal(percentDelta(1, 0), null)
})

test('metricMedians aggregates every observed numeric metric', () => {
  assert.deepEqual(
    metricMedians([
      { rss: 30, elu: 10 },
      { rss: 10, elu: null },
      { rss: 20, heap: 5 }
    ]),
    { rss: 20, elu: 10, heap: 5 }
  )
})
