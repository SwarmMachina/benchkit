# @swarmmachina/benchkit

Zero-runtime-dependency TypeScript helpers for SwarmMachina benchmark and regression pipelines. The package is ESM-only and publishes compiled JavaScript, declarations, declaration maps, and source maps from `dist/`.

## Installation

Install it in the development contour:

```bash
npm install --save-dev @swarmmachina/benchkit
```

Node.js 22.x and 24.x are supported.

## Usage

JavaScript consumers can use the root export or a subpath export:

```js
import { median, metricGuard } from '@swarmmachina/benchkit'
import Metrics from '@swarmmachina/benchkit/metrics'
```

TypeScript consumers get the same runtime API and published declarations:

```ts
import metricGuard, { type MetricGuardParams, type MetricGuardResult } from '@swarmmachina/benchkit/metric-guard'

export function guardMetrics(params: MetricGuardParams): MetricGuardResult {
  return metricGuard(params)
}
```

## Modules

| Subpath             | Exports                                           | Purpose                                                       |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| `baseline`          | `validateBaseline`, `isBaseline`, baseline types  | Validate committed regression baseline files without throwing |
| `copy-cpu-profiles` | `copyCpuProfiles`, bench result types             | Copy and parse V8 CPU profile artifacts                       |
| `cpu-guard`         | `cpuGuard`, CPU guard/profile types               | Enforce CPU profile sanity thresholds                         |
| `ensure-dir`        | `ensureDir`                                       | Create a directory recursively                                |
| `format`            | `fmtBytes`, `fmtNum`, `formatYmdHms`, `msToHuman` | Format benchmark values and timestamps                        |
| `latency-recorder`  | `createLatencyRecorder`, latency types            | Record bounded latency samples and percentiles                |
| `median`            | `median`                                          | Compute the median without mutating the input                 |
| `metric-guard`      | `metricGuard`, metric guard types                 | Enforce min/max regression bounds                             |
| `metrics`           | `Metrics`, metrics types                          | Sample process, memory, ELU, delay, and host load metrics     |
| `parse-args`        | `parseArgs`, `ArgHandler`                         | Parse benchmark CLI flags with explicit handlers              |
| `run-child`         | `runChild`                                        | Run a Node child process and reject on failure                |
| `shuffle`           | `shuffle`                                         | Shuffle an array in place for AB/BA balancing                 |
| `step-summary`      | `appendStepSummary`, `round`, `fmt`, `mdTable`    | Build and publish GitHub step summaries                       |
| `timed-fn`          | `timed`, `TimedResult`                            | Time sync or async functions                                  |
| `v8-prof-parser`    | `parseV8Profile`, V8 profile types                | Parse `node --prof-process` text output                       |
| `v8-prof-run`       | `pickNewestLog`, `processV8Profile`               | Locate and process V8 log files                               |
| `wait-for-message`  | `waitForMessage`                                  | Wait for a matching child-process IPC message                 |

Every module is also available as a named export from `@swarmmachina/benchkit`.

## Baseline validation

`validateBaseline(value)` returns `{ ok, errors }` and never throws. `isBaseline(value)` is the corresponding TypeScript type guard when direct narrowing is needed.

```ts
import { isBaseline, validateBaseline } from '@swarmmachina/benchkit/baseline'

const result = validateBaseline(value)

if (!result.ok) {
  console.error(result.errors)
}

if (isBaseline(value)) {
  console.log(value.benchmark.name)
}
```

## Development

```bash
npm run check
npm test
npm run build
npm pack --dry-run
```

Tests execute TypeScript sources directly with Node type stripping. The independent type-check and build steps verify declarations and emitted JavaScript.

## License

MPL-2.0
