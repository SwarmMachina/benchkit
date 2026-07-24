import assert from 'node:assert/strict'
import test from 'node:test'
import { metricGuard, relativeMetricGuard } from '@swarmmachina/benchkit'

test('relativeMetricGuard applies direction, relative allowance and absolute slack', () => {
  const result = relativeMetricGuard({
    metrics: [
      {
        name: 'throughput',
        candidate: 94_999,
        reference: 100_000,
        direction: 'higher',
        maxRegressionPct: 5
      },
      {
        name: 'p99',
        candidate: 12.3,
        reference: 10,
        direction: 'lower',
        maxRegressionPct: 20,
        absoluteSlack: 0.25
      },
      {
        name: 'rss',
        candidate: 120 * 1024 ** 2,
        reference: 100 * 1024 ** 2,
        direction: 'lower',
        maxRegressionPct: 15,
        absoluteSlack: 5 * 1024 ** 2
      }
    ]
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.failures.length, 2)
  assert.deepEqual(
    result.rows.map(({ name, boundary, status }) => ({ name, boundary, status })),
    [
      { name: 'throughput', boundary: 95_000, status: 'fail' },
      { name: 'p99', boundary: 12.25, status: 'fail' },
      { name: 'rss', boundary: 120 * 1024 ** 2, status: 'pass' }
    ]
  )
})

test('relativeMetricGuard reports non-finite candidate and reference values', () => {
  const result = relativeMetricGuard({
    metrics: [
      {
        name: 'throughput',
        candidate: Number.NaN,
        reference: Number.POSITIVE_INFINITY,
        direction: 'higher',
        maxRegressionPct: 5
      }
    ]
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.rows[0]?.boundary, null)
  assert.deepEqual(result.failures, ['throughput: candidate must be finite', 'throughput: reference must be finite'])
})

test('relativeMetricGuard rejects invalid rule configuration', () => {
  assert.throws(
    () =>
      relativeMetricGuard({
        metrics: [
          {
            name: 'rss',
            candidate: 1,
            reference: 1,
            direction: 'lower',
            maxRegressionPct: -1
          }
        ]
      }),
    RangeError
  )
})

test('existing metricGuard behavior remains available', () => {
  assert.deepEqual(
    metricGuard({
      cases: ['base'],
      results: { base: { rps: 99 } },
      baselineTests: { base: { guards: { rps: { min: 100 } } } }
    }).failures,
    ['base.rps: 99 < 100']
  )
})
