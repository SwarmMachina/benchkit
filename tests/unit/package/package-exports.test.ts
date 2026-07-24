import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

interface ExportTarget {
  types: string
  import: string
}

test('every public export resolves to emitted runtime and declaration files', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    name: string
    exports: Record<string, ExportTarget>
  }

  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    await fs.access(new URL(`../../../${target.import}`, import.meta.url))
    await fs.access(new URL(`../../../${target.types}`, import.meta.url))

    const specifier = subpath === '.' ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`
    const exports = (await import(specifier)) as object

    assert.equal(typeof exports, 'object', specifier)
  }
})

test('new benchmark primitives are available through explicit package exports', async () => {
  const expected = new Map<string, readonly string[]>([
    ['@swarmmachina/benchkit/balanced-schedule', ['balancedSchedule']],
    [
      '@swarmmachina/benchkit/benchmark-artifact',
      ['BENCHMARK_ARTIFACT_SCHEMA_VERSION', 'createBenchmarkArtifact', 'writeBenchmarkArtifact']
    ],
    ['@swarmmachina/benchkit/batch-measurement-report', ['renderBatchMeasurementsMarkdown']],
    ['@swarmmachina/benchkit/bounded-latency-recorder', ['BoundedLatencyRecorder']],
    ['@swarmmachina/benchkit/delay', ['default']],
    ['@swarmmachina/benchkit/get-free-port', ['default', 'getFreePort']],
    ['@swarmmachina/benchkit/load/http1', ['runHttp1Load']],
    [
      '@swarmmachina/benchkit/managed-child-process',
      ['terminateChildProcess', 'terminateWindowsProcessTree', 'waitForChildExit']
    ],
    ['@swarmmachina/benchkit/measure-scenario', ['default']],
    ['@swarmmachina/benchkit/memory-growth', ['forceGc', 'measureMemoryGrowth']],
    ['@swarmmachina/benchkit/paired-comparison', ['pairedComparison', 'tukeyHinges']],
    ['@swarmmachina/benchkit/perf-stat', ['normalizePerfCounters', 'parsePerfStat']],
    ['@swarmmachina/benchkit/process-memory', ['ProcessMemorySampler']],
    ['@swarmmachina/benchkit/relative-metric-guard', ['relativeMetricGuard']],
    [
      '@swarmmachina/benchkit/v8-heap-allocation-sampler',
      ['V8HeapAllocationSampler', 'sampleV8HeapAllocations', 'sampledAllocationBytes']
    ]
  ])

  for (const [specifier, names] of expected) {
    const exports = (await import(specifier)) as Record<string, unknown>

    for (const name of names) {
      assert.ok(name in exports, `${specifier} should export ${name}`)
    }
  }
})

test('agent binary and embedded package version match package metadata', async () => {
  const packageJson = JSON.parse(await fs.readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as {
    version: string
    bin: Record<string, string>
  }
  const benchkit = (await import('@swarmmachina/benchkit')) as { BENCHKIT_VERSION: string }
  const binary = await fs.readFile(new URL(`../../../${packageJson.bin['benchkit-agent']}`, import.meta.url), 'utf8')

  assert.equal(benchkit.BENCHKIT_VERSION, packageJson.version)
  assert.match(binary, /^#!\/usr\/bin\/env node/u)
})
