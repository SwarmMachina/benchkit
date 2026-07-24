import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  BENCHMARK_ARTIFACT_SCHEMA_VERSION,
  createBenchmarkArtifact,
  writeBenchmarkArtifact
} from '@swarmmachina/benchkit'

test('benchmark artifacts have a stable schema and environment', () => {
  const environment = {
    nodeVersion: 'v24.0.0',
    platform: 'linux' as const,
    arch: 'x64',
    hostname: 'runner',
    osRelease: '1',
    cpuModel: 'cpu',
    cpuCount: 8,
    totalMemoryBytes: 1024
  }
  const artifact = createBenchmarkArtifact({
    suite: 'protocol',
    generatedAt: '2026-07-24T00:00:00.000Z',
    environment,
    parameters: { iterations: 50_000 },
    results: [{ operationsPerSecond: 1 }]
  })

  assert.equal(artifact.schemaVersion, BENCHMARK_ARTIFACT_SCHEMA_VERSION)
  assert.equal(artifact.environment, environment)
  assert.deepEqual(artifact.parameters, { iterations: 50_000 })
})

test('writeBenchmarkArtifact replaces the destination atomically', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'benchkit-artifact-'))
  const output = path.join(directory, 'nested', 'result.json')

  context.after(() => fs.rm(directory, { force: true, recursive: true }))
  const artifact = createBenchmarkArtifact({
    suite: 'protocol',
    parameters: {},
    results: []
  })

  await writeBenchmarkArtifact(output, artifact)
  const written = JSON.parse(await fs.readFile(output, 'utf8')) as typeof artifact

  assert.equal(written.schemaVersion, BENCHMARK_ARTIFACT_SCHEMA_VERSION)
  assert.equal(written.suite, 'protocol')
})
