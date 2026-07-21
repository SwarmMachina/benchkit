import assert from 'node:assert/strict'
import test from 'node:test'
import metricGuard from '../../src/metric-guard.ts'

test('metricGuard accepts values inside min and max bounds', () => {
  assert.deepEqual(
    metricGuard({
      cases: ['base'],
      results: { base: { rps: 120, latency: 8 } },
      baselineTests: {
        base: { guards: { rps: { min: 100 }, latency: { max: 10 } } }
      }
    }),
    {
      failures: [],
      rows: [
        { case: 'base', metric: 'rps', value: 120, min: 100, max: null, status: 'ok' },
        { case: 'base', metric: 'latency', value: 8, min: null, max: 10, status: 'ok' }
      ]
    }
  )
})

test('metricGuard reports min and max violations', () => {
  const result = metricGuard({
    cases: ['base'],
    results: { base: { rps: 90, latency: 11 } },
    baselineTests: {
      base: { guards: { rps: { min: 100 }, latency: { max: 10 } } }
    }
  })

  assert.deepEqual(result.failures, ['base.rps: 90 < 100', 'base.latency: 11 > 10'])
  assert.deepEqual(
    result.rows.map((row) => row.status),
    ['FAIL', 'FAIL']
  )
})

test('metricGuard reports missing baselines and values', () => {
  const result = metricGuard({
    cases: ['missing-baseline', 'missing-value'],
    results: {},
    baselineTests: { 'missing-value': { guards: { rps: { min: 1 } } } }
  })

  assert.deepEqual(result.failures, ['missing-baseline: missing baseline', 'missing-value.rps: missing value'])
})
