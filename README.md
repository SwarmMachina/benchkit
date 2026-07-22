# @swarmmachina/benchkit

Zero-runtime-dependency benchmark, profiling and regression helpers for
SwarmMachina projects. The package provides typed building blocks without
coupling benchmark suites to a transport, framework or load generator.

## Includes

- Statistical primitives with explicit quantile algorithms
- Process, memory, ELU, event-loop delay and latency measurement
- Typed benchmark result contracts
- Baseline validation and metric/CPU regression guards
- V8 CPU profile processing
- Child-process orchestration and GitHub step-summary reporting
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

| Subpath         | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `measurement`   | Runtime metrics, latency recording, batch measurement and time  |
| `orchestration` | CLI parsing, directories, child processes and run ordering      |
| `profiling`     | V8 log processing, parsing and CPU profile artifact collection  |
| `regression`    | Baseline validation, guards and Markdown regression reports     |
| `reporting`     | Value formatting, Markdown tables and GitHub step summaries     |
| `results`       | Generic typed benchmark result and profiling artifact contracts |
| `statistics`    | Median, distributions, metric medians and percentage deltas     |
| `units`         | Unit conversions shared by measurement and reporting code       |

Every domain export is also available as a named export from
`@swarmmachina/benchkit`.

## Statistics

Percentile semantics are explicit because benchmark tools use different
algorithms:

- `quantileLinear(values, q)` interpolates between adjacent samples.
- `quantileNearestRank(values, q)` selects the nearest-rank sample.
- `finiteMedian(values)` ignores null, missing and non-finite samples.
- `percentDelta(candidate, reference)` uses the reference as the denominator.

Quantiles use values from `0` to `1`. Statistical functions do not round their
results; apply presentation rounding in the reporting layer.

## Batch measurement

`measureBatch` records wall time, operations per second, ELU, memory deltas and
nearest-rank p50/p95/p99 latency. Setup and stabilization remain explicit through
the optional `before` hook; the helper never forces garbage collection.

```ts
import { measureBatch } from '@swarmmachina/benchkit/measurement'

const result = await measureBatch({
  operations: 10_000,
  before: () => new Promise<void>((resolve) => setImmediate(resolve)),
  run: () => runScenario()
})
```

The scenario returns latency samples in milliseconds. Scenario names,
concurrency and transport-specific metadata stay in the consuming benchmark.

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

## Directory structure

```text
src/
├── measurement/
├── orchestration/
├── profiling/
├── regression/
├── reporting/
├── results/
├── statistics/
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
pnpm build
pnpm pack --dry-run
```

Tests run against the compiled package exports. The build starts from a clean
`dist/`, and the type-check independently validates the TypeScript sources.

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
