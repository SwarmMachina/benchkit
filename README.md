# @swarmmachina/benchkit

Zero-runtime-dependency benchmark, profiling and regression helpers for
SwarmMachina projects. The package provides transport-neutral building blocks
plus an opt-in HTTP/1 load driver.

## Includes

- Statistical primitives with explicit quantile algorithms
- Process, memory, ELU, event-loop delay and latency measurement
- Typed benchmark result contracts
- Baseline validation and metric/CPU regression guards
- V8 CPU profile processing
- Child-process orchestration and GitHub step-summary reporting
- Local and SSH target lifecycle through a short-lived stdio agent
- Closed-loop HTTP/1.1 load generation through an isolated package subpath
- ESM JavaScript, TypeScript declarations and source maps

## Runtime

- Node.js 22.13+ or 24
- Native ES modules
- No runtime dependencies

## Installation

Install as a development dependency:

```bash
pnpm add -D @swarmmachina/benchkit
```

## Usage

The complete public API is available from the package root:

```ts
import { measureBatch, median, metricGuard, type BenchmarkResult } from '@swarmmachina/benchkit'

const result: BenchmarkResult = {
  runs: [{ run: 1, rows: [{ fw: 'core' }] }]
}

const throughputMedian = median([101_000, 99_000, 100_000])
const guard = metricGuard({
  cases: ['base'],
  results: { base: { rps: throughputMedian } },
  baselineTests: { base: { guards: { rps: { min: 95_000 } } } }
})

const measured = await measureBatch({
  operations: 3,
  run: async () => {
    await Promise.resolve()
    return [0.4, 0.5, 0.6]
  }
})

console.log(result.runs.length, guard.failures, measured.operationsPerSecond)
```

Domain exports are available when a narrower import surface is preferred:

```ts
import { measureBatch, Metrics } from '@swarmmachina/benchkit/measurement'
import { metricGuard, renderRegressionMarkdown } from '@swarmmachina/benchkit/regression'
import { median, quantileLinear } from '@swarmmachina/benchkit/statistics'
import { bytesToMiB } from '@swarmmachina/benchkit/units'
```

Existing module-level imports such as `@swarmmachina/benchkit/metrics` and
`@swarmmachina/benchkit/metric-guard` remain supported through explicit package
exports. The physical `dist/` layout is not part of the public contract.

## Modules

| Subpath           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `measurement`     | Runtime metrics, latency recording, batch measurement and time  |
| `control`         | Versioned protocol, state machine, errors and environment data  |
| `load/http1`      | Closed-loop HTTP/1.1 load generation and generator health       |
| `orchestration`   | CLI parsing, directories, child processes and run ordering      |
| `profiling`       | V8 log processing, parsing and CPU profile artifact collection  |
| `regression`      | Baseline validation, guards and Markdown regression reports     |
| `reporting`       | Value formatting, Markdown tables and GitHub step summaries     |
| `results`         | Generic typed benchmark result and profiling artifact contracts |
| `statistics`      | Median, distributions, metric medians and percentage deltas     |
| `target`          | Minimal target-side runtime and metrics lifecycle               |
| `target-provider` | Local/SSH providers and `TargetSession`                         |
| `units`           | Unit conversions shared by measurement and reporting code       |

Transport-neutral domain exports are also available from
`@swarmmachina/benchkit`. The HTTP/1 driver remains subpath-only so importing
the package root never initializes load-generator code.

## HTTP/1 load generation

`runHttp1Load()` drives a fixed number of HTTP/1.1 keep-alive connections from
worker threads. It supports pipelining, discarded warmup, fixed and chunked
responses, bounded latency histograms, status/error counters and generator-side
ELU and memory.

```ts
import { runHttp1Load } from '@swarmmachina/benchkit/load/http1'

const result = await runHttp1Load({
  name: 'base-sync',
  url: 'http://127.0.0.1:3000/base-sync',
  connections: 100,
  pipelining: 10,
  workers: 4,
  warmupMs: 2_000,
  durationMs: 10_000
})

console.log(
  result.requests.averagePerSecond,
  result.latencyMs.averageMs,
  result.latencyMs.p95Ms,
  result.latencyMs.p99Ms,
  result.loadGenerator.maxWorkerEluPct
)
```

The driver is closed-loop: each completed response releases one replacement
request on the same connection. See [HTTP/1 load generator](docs/http1-load.md)
for framing support, measurement semantics, limitations and the local capacity
smoke command.

## Statistics

Percentile semantics are explicit because benchmark tools use different
algorithms:

- `quantileLinear(values, q)` interpolates between adjacent samples.
- `quantileNearestRank(values, q)` selects the nearest-rank sample.
- `finiteMedian(values)` ignores null, missing and non-finite samples.
- `percentDelta(candidate, reference)` uses the reference as the denominator.

Quantiles use values from `0` to `1`. Statistical functions do not round their
results; apply presentation rounding in the reporting layer.

### Paired comparisons

`pairedComparison` validates each candidate/reference pair, retains each signed
percentage delta, and reports medians, wins and an explicitly named
median-of-halves Tukey-hinges IQR. The central observation is excluded from both
halves for odd sample counts; this is intentionally distinct from linear
quartiles.

```ts
import { pairedComparison } from '@swarmmachina/benchkit/statistics'

const comparison = pairedComparison(
  [
    { candidate: 102_000, reference: 100_000 },
    { candidate: 99_000, reference: 98_000 }
  ],
  { direction: 'higher' }
)

console.log(comparison.medianPairedDeltaPct, comparison.iqr)
```

## Batch measurement

`measureBatch` records wall time, operations per second, ELU, memory deltas and
nearest-rank p50/p95/p99 latency. Setup and stabilization remain explicit
through the optional `before` hook; the helper never forces garbage collection.

```ts
import { measureBatch } from '@swarmmachina/benchkit/measurement'

const result = await measureBatch({
  operations: 10_000,
  before: () => new Promise<void>((resolve) => setImmediate(resolve)),
  run: () => runScenario()
})
```

The scenario may return exact latency samples in milliseconds or a
`BoundedLatencySnapshot`. Raw arrays preserve exact nearest-rank behavior.
Snapshots keep instrumentation memory bounded and expose their count, dropped
samples, p97.5 and maximum relative error through `latencyDetails`.

Set `memorySampleMs` to add start/end/peak process memory without changing the
existing memory-delta fields.

### Mergeable bounded latency

`createBoundedLatencyRecorder` uses a fixed logarithmic histogram instead of
retaining raw or last-N samples. Recording is O(1), memory is bounded by the
configured range and accuracy, and worker snapshots can be merged without
moving millions of samples.

```ts
import { createBoundedLatencyRecorder } from '@swarmmachina/benchkit/measurement'

const worker = createBoundedLatencyRecorder({
  lowestDiscernibleMs: 0.001,
  highestTrackableMs: 60_000,
  relativeAccuracy: 0.01
})

worker.record(0.42)

const aggregate = createBoundedLatencyRecorder()

aggregate.merge(worker.snapshot())
console.log(aggregate.summary().p99Ms)
```

Percentiles use nearest-rank over histogram counts and return the selected
bucket midpoint. For accepted non-zero samples the default maximum relative
value error is 1%; zero is exact. Samples below/above the configured range and
non-finite samples are counted as dropped and are never folded into endpoint
buckets.

`measureScenario()` adds stable name, connection and pipelining dimensions over
`measureBatch()`. Its results can be rendered and stored without project-local
adapters:

```ts
import { createBoundedLatencyRecorder, measureScenario } from '@swarmmachina/benchkit/measurement'
import { renderBatchMeasurementsMarkdown } from '@swarmmachina/benchkit/reporting'
import { createBenchmarkArtifact, writeBenchmarkArtifact } from '@swarmmachina/benchkit/results'

const latency = createBoundedLatencyRecorder()
const result = await measureScenario({
  name: 'request/response',
  connections: 1,
  pipelining: 128,
  operations: 50_000,
  memorySampleMs: 10,
  run: async () => {
    await runLoad((ms) => latency.record(ms))
    return latency.snapshot()
  }
})

console.log(renderBatchMeasurementsMarkdown([result], { parameters: 'connections=1 pipelining=128' }))
await writeBenchmarkArtifact(
  'benchmark-results/protocol.json',
  createBenchmarkArtifact({
    suite: 'protocol',
    parameters: { connections: 1, pipelining: 128 },
    results: [result]
  })
)
```

Artifacts use the versioned `benchmark-run/v1` schema and include a host,
runtime, CPU and memory environment snapshot. File replacement is atomic within
the destination filesystem.

### Process memory

Process memory sampling is separate from `Metrics`, so the existing
`MetricsSummary` units and semantics remain unchanged.

```ts
import { ProcessMemorySampler } from '@swarmmachina/benchkit/measurement'

const memory = new ProcessMemorySampler()

memory.start({ sampleMs: 50 })
await runScenario()
const summary = memory.stop()

console.log(summary?.rss.startBytes, summary?.rss.peakBytes, summary?.rss.deltaBytes)
```

For leak and plateau tests, `measureMemoryGrowth()` performs explicit warmup,
stabilized GC cycles and two retained-memory snapshots. It returns measurements
without embedding assertion policy:

```ts
import { measureMemoryGrowth } from '@swarmmachina/benchkit/measurement'

const growth = await measureMemoryGrowth({
  warmup: 100,
  iterations: 1_000,
  run: (iteration) => churn(iteration)
})

console.log(growth.heapUsed.deltaBytes, growth.rss.deltaBytes)
```

This helper requires `node --expose-gc`.

## Regression reports

`renderRegressionMarkdown` combines `MetricGuardResult` and `CpuGuardResult`
without writing files or logging. The caller controls where the report is sent.

```ts
import { cpuGuard, metricGuard, renderRegressionMarkdown } from '@swarmmachina/benchkit/regression'

const markdown = renderRegressionMarkdown({
  suite: 'http',
  metric: metricGuard(metricInput),
  cpu: cpuGuard(cpuInput)
})
```

`validateBaseline(value)` returns `{ ok, errors }` and never throws.
`isBaseline(value)` is the corresponding TypeScript type guard.

### Relative regression guard

`relativeMetricGuard` compares candidate values directly with a reference. A
higher-is-better boundary subtracts the allowed relative regression and
absolute slack; a lower-is-better boundary adds them.

```ts
import { relativeMetricGuard } from '@swarmmachina/benchkit/regression'

const guard = relativeMetricGuard({
  metrics: [
    {
      name: 'throughput',
      candidate: 98_000,
      reference: 100_000,
      direction: 'higher',
      maxRegressionPct: 5
    },
    {
      name: 'p99',
      candidate: 10.5,
      reference: 10,
      direction: 'lower',
      maxRegressionPct: 20,
      absoluteSlack: 0.25
    }
  ]
})

console.log(guard.status, guard.rows)
```

## Benchmark orchestration

Balanced schedules alternate candidate/reference order deterministically. Strict
balance is enabled by default and requires an even run count.

```ts
import { balancedSchedule, parseArgs } from '@swarmmachina/benchkit/orchestration'

const schedule = balancedSchedule({ runs: 6, candidate: 'swm', reference: 'uws' })
const options = parseArgs(process.argv.slice(2), { runs: 6 }, handlers, { strict: true })
```

Legacy `parseArgs(argv, defaults, handlers)` behavior remains unchanged: it
starts at offset 2 and ignores unknown arguments. Strict mode defaults to offset
0 for already-sliced argv; set `offset` explicitly for a full argv.

`getFreePort()` selects an ephemeral loopback port by default and can search a
bounded range for local or remote benchmark targets:

```ts
import { getFreePort } from '@swarmmachina/benchkit/orchestration'

const port = await getFreePort({ host: '127.0.0.1', range: [30_000, 30_100] })
```

The returned port is available when checked but is not reserved. Start the
target immediately to minimize the interval in which another process could bind
it.

`terminateChildProcess()` provides bounded `SIGTERM`/`SIGKILL` escalation.
With `killTree: true`, it terminates a detached POSIX process group or uses
bounded `taskkill /T /F` on Windows. Callers must spawn POSIX children with
`detached: true` before requesting process-group termination.

## Local and remote targets

Benchkit keeps load generation in the caller and owns only the target lifecycle.
The endpoint is protocol-neutral, so the caller decides whether it represents
HTTP, WebSocket, or another load protocol.

```ts
import { createTargetProvider } from '@swarmmachina/benchkit'

const provider = createTargetProvider({
  mode: 'local',
  cwd: process.cwd()
})
const session = await provider.start({
  entrypoint: './benchmark/server.js',
  args: ['--fw', 'core', '--test', 'base-sync'],
  port: { range: [30_000, 30_100] }
})

try {
  await session.waitReachable()
  await session.startMetrics({ sampleMs: 250 })

  const url = `http://${session.endpoint.host}:${session.endpoint.port}/base-sync`
  await runLoad(url)

  const metrics = await session.stopMetrics()
  console.log(metrics, session.targetEnvironment)
} finally {
  await session.stop()
}
```

The target script uses the separate target export and registers its framework
shutdown hook before reporting process readiness:

```ts
import { createTargetRuntime } from '@swarmmachina/benchkit/target'

const runtime = createTargetRuntime({ metrics: true })
const server = await createServerFromArgs()

await server.listen()
runtime.registerShutdown(() => server.shutdown())
runtime.ready({ port: server.port })
```

### Two-machine setup

Machine A runs the benchmark and load generator. Machine B runs the target,
metrics sampler, and target-side artifacts. Before starting, install the same
benchkit version and the target project on machine B; benchkit does not install
packages or synchronize repositories.

```ts
const provider = createTargetProvider({
  mode: 'ssh',
  ssh: {
    destination: 'bench@10.10.0.2',
    cwd: '/opt/swm-core'
  },
  bindHost: '0.0.0.0',
  connectHost: '10.10.0.2'
})
```

For the migrated `swm-core` HTTP suite, the complete runner command on machine A
is:

```bash
node benchmark/bench.js \
  --test base-sync \
  --fw core \
  --target ssh \
  --ssh-destination bench@10.10.0.2 \
  --target-dir /opt/swm-core \
  --bind-host 0.0.0.0 \
  --connect-host 10.10.0.2 \
  --port-range 30000-30100
```

`ssh.destination` is used only for the control plane. `bindHost` controls the
listen address on machine B, while `connectHost` is the address machine A probes
and loads; wildcard addresses such as `0.0.0.0` are rejected as connect hosts.
The runner starts `<targetDir>/node_modules/.bin/benchkit-agent --stdio` over
SSH with a validated base64 JSON configuration. Set `ssh.agentCommand` only
when the package is installed elsewhere. The agent has no management port and
exits with the target.

TCP reachability is checked from machine A after target process readiness.
Failures include bind/connect addresses, port, last network error, and a
firewall/listen-address hint. Target stdout/stderr is kept out of the NDJSON
control stream and retained in a bounded diagnostic buffer.

Remote V8 profiling is intentionally unsupported in the first release and
fails before SSH starts with `UnsupportedFeatureError`; local profiling remains
available with `profile: { directory }`. A real SSH integration test is opt-in:

```bash
BENCHKIT_SSH_DESTINATION=bench@10.10.0.2 \
BENCHKIT_SSH_CWD=/opt/benchkit \
BENCHKIT_SSH_CONNECT_HOST=10.10.0.2 \
pnpm test:integration
```

The public API and NDJSON frames are specified in
[`docs/target-control.md`](docs/target-control.md).

## Allocation and hardware profiling

The V8 allocation sampler owns its inspector lifecycle and always returns the
raw profile alongside sampled bytes. The bytes remain a sampled estimate; the
consumer divides by its own operation count.

```ts
import { normalizePerfCounters, parsePerfStat, sampleV8HeapAllocations } from '@swarmmachina/benchkit/profiling'

const allocation = await sampleV8HeapAllocations(() => runScenario(), {
  samplingIntervalBytes: 32 * 1024,
  includeCollectedObjects: true
})

const counters = normalizePerfCounters(parsePerfStat(perfStatCsv), operations)

console.log(allocation.sampledAllocationBytes, allocation.profile, counters)
```

`parsePerfStat` only parses `perf stat -x,` output; process execution, CPU
affinity and Linux platform checks remain the caller's responsibility.
`<not supported>` and `<not counted>` values stay unavailable (`null`) rather
than becoming zero.

## Directory structure

```text
src/
├── agent/
├── control/
├── measurement/
├── orchestration/
├── profiling/
├── regression/
├── reporting/
├── results/
├── statistics/
├── target/
├── target-provider/
├── units/
└── index.ts
```

Each directory owns a cohesive domain and exposes a local `index.ts` barrel.
The root barrel composes those domains into the package API.

## Development

The repository pins pnpm 11.15.1 through the `packageManager` field. Corepack
and CI use that exact version. TypeScript compilation uses the native 7.0.2
compiler, while TypeScript-aware linting uses the supported TypeScript 6 API
sidecar prescribed by `@swarmmachina/standards`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm test:packed-types
pnpm build
pnpm pack --dry-run
```

Tests run against the compiled package exports. The build starts from a clean
`dist/`, and the type-check independently validates the TypeScript sources.
The packed-types check installs the generated tarball into a temporary consumer
and verifies every declaration entry under NodeNext and Bundler resolution.

## Release

CI publishes only tags matching the package version (`vX.Y.Z`). The tagged
commit must belong to `master`, and the package must pass checks, unit tests and
builds on Node.js 22 and 24 before publication.

Manual workflow dispatch runs the gates without publishing. Package publication
is performed by CI with npm provenance and GitHub OIDC; do not publish from a
local workstation. The release workflow fails closed if the repository is not
public, because npm cannot generate provenance for a public package from a
private GitHub repository. After publication, CI waits for npm registry
propagation and verifies the published SLSA provenance attestation. Publish is
idempotent: rerunning the tag workflow skips an existing version only when its
provenance is valid.

## License

Licensed under the MPL-2.0 License.

Copyright Contributors to SwarmMachina.

See the [LICENSE](LICENSE) file for details.
