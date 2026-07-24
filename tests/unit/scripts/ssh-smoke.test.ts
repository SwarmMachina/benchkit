import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSupportedNodeVersion, resolveSshSmokeConfiguration } from '../../../scripts/run-ssh-smoke.js'

test('SSH smoke configuration creates an isolated remote directory', () => {
  assert.deepEqual(
    resolveSshSmokeConfiguration(
      {
        BENCHKIT_SSH_DESTINATION: 'bench@example.test',
        BENCHKIT_SSH_CONNECT_HOST: '192.0.2.10'
      },
      'test-token'
    ),
    {
      destination: 'bench@example.test',
      connectHost: '192.0.2.10',
      remoteDirectory: '/tmp/benchkit-smoke-test-token',
      keepRemote: false
    }
  )
})

test('SSH smoke configuration rejects missing or unsafe values', () => {
  assert.throws(() => resolveSshSmokeConfiguration({}, 'test-token'), /missing SSH smoke environment/u)
  assert.throws(
    () =>
      resolveSshSmokeConfiguration(
        {
          BENCHKIT_SSH_DESTINATION: 'bench@example.test',
          BENCHKIT_SSH_CONNECT_HOST: '192.0.2.10',
          BENCHKIT_SSH_REMOTE_BASE: '/tmp/../var'
        },
        'test-token'
      ),
    /absolute shell-safe path/u
  )
  assert.throws(
    () =>
      resolveSshSmokeConfiguration(
        {
          BENCHKIT_SSH_DESTINATION: '-oProxyCommand=bad',
          BENCHKIT_SSH_CONNECT_HOST: '192.0.2.10'
        },
        'test-token'
      ),
    /must not contain whitespace or control characters/u
  )
})

test('SSH smoke accepts only supported remote Node.js versions', () => {
  assert.equal(parseSupportedNodeVersion('v22.18.0\n'), 22)
  assert.equal(parseSupportedNodeVersion('v24.17.0\n'), 24)
  assert.throws(() => parseSupportedNodeVersion('v20.19.0\n'), /must be version 22 or 24/u)
})
