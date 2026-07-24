import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveAgentSoakConfiguration, summarizeAgentSoakValues } from '../../../scripts/ssh-agent-soak.js'

const required = {
  BENCHKIT_SSH_DESTINATION: 'root@example.test',
  BENCHKIT_SSH_CONNECT_HOST: '192.0.2.10',
  BENCHKIT_SSH_CWD: '/tmp/benchkit-smoke-test'
}

test('agent SSH soak resolves bounded defaults and overrides', () => {
  assert.deepEqual(resolveAgentSoakConfiguration(required), {
    destination: 'root@example.test',
    connectHost: '192.0.2.10',
    cwd: '/tmp/benchkit-smoke-test',
    iterations: 20,
    concurrency: 4,
    metricsMs: 100
  })

  assert.deepEqual(
    resolveAgentSoakConfiguration({
      ...required,
      BENCHKIT_SSH_SOAK_ITERATIONS: '8',
      BENCHKIT_SSH_SOAK_CONCURRENCY: '2',
      BENCHKIT_SSH_SOAK_METRICS_MS: '250'
    }),
    {
      destination: 'root@example.test',
      connectHost: '192.0.2.10',
      cwd: '/tmp/benchkit-smoke-test',
      iterations: 8,
      concurrency: 2,
      metricsMs: 250
    }
  )
})

test('agent SSH soak rejects unsafe load parameters', () => {
  assert.throws(
    () => resolveAgentSoakConfiguration({ ...required, BENCHKIT_SSH_SOAK_ITERATIONS: '0' }),
    /must be an integer between 1 and 200/u
  )
  assert.throws(
    () =>
      resolveAgentSoakConfiguration({
        ...required,
        BENCHKIT_SSH_SOAK_ITERATIONS: '2',
        BENCHKIT_SSH_SOAK_CONCURRENCY: '3'
      }),
    /cannot exceed/u
  )
})

test('agent SSH soak reports explicit nearest-rank percentiles', () => {
  assert.deepEqual(summarizeAgentSoakValues([5, 1, 2, 3, 4]), {
    p50: 3,
    p95: 5,
    p99: 5,
    max: 5
  })
  assert.throws(() => summarizeAgentSoakValues([]), /requires finite values/u)
})
