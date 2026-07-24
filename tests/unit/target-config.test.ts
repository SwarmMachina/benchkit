import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ConfigurationError,
  createTargetProvider,
  UnsupportedFeatureError,
  VersionMismatchError
} from '@swarmmachina/benchkit'
import { decodeAgentConfiguration } from '../../dist/agent/config.js'
import { BENCHKIT_VERSION, PROTOCOL_VERSION } from '@swarmmachina/benchkit/control'

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64')
}

test('provider keeps bind and connect addresses distinct and rejects wildcard connect hosts', () => {
  const provider = createTargetProvider({
    mode: 'ssh',
    bindHost: '0.0.0.0',
    connectHost: '10.10.0.2',
    ssh: { destination: 'bench@10.10.0.2', cwd: '/opt/swm-core' }
  })

  assert.equal(provider.bindHost, '0.0.0.0')
  assert.equal(provider.connectHost, '10.10.0.2')

  assert.throws(
    () =>
      createTargetProvider({
        mode: 'ssh',
        connectHost: '0.0.0.0',
        ssh: { destination: 'bench@host', cwd: '/opt/project' }
      }),
    ConfigurationError
  )
})

test('agent configuration validates protocol and package versions', () => {
  const base = {
    protocolVersion: PROTOCOL_VERSION,
    benchkitVersion: BENCHKIT_VERSION,
    diagnosticsMaxBytes: 1024,
    commandMs: 100,
    shutdownGraceMs: 100,
    killMs: 100
  }

  assert.equal(decodeAgentConfiguration(encode(base)).benchkitVersion, BENCHKIT_VERSION)
  assert.throws(
    () => decodeAgentConfiguration(encode({ ...base, protocolVersion: PROTOCOL_VERSION + 1 })),
    VersionMismatchError
  )
  assert.throws(() => decodeAgentConfiguration(encode({ ...base, benchkitVersion: '999.0.0' })), VersionMismatchError)
})

test('remote profiling fails before SSH is started', async () => {
  const provider = createTargetProvider({
    mode: 'ssh',
    connectHost: '10.10.0.2',
    ssh: { destination: 'bench@10.10.0.2', cwd: '/opt/swm-core' }
  })

  await assert.rejects(provider.start({ entrypoint: './benchmark/server.js', profile: true }), UnsupportedFeatureError)
})
