# @swarmmachina/benchkit

[![CI](https://github.com/SwarmMachina/benchkit/actions/workflows/ci.yml/badge.svg)](https://github.com/SwarmMachina/benchkit/actions/workflows/ci.yml)
[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Node.js](https://img.shields.io/badge/node-22%20%7C%2024-brightgreen.svg)](https://nodejs.org/)
[![runtime dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen.svg)](#runtime-design)

Zero-dependency benchmark, load-generation, profiling, and regression tools for
Node.js 22 and 24.

`benchkit` provides focused HTTP/1.1 and WebSocket load generators, bounded latency
histograms, process and event-loop measurements, benchmark result contracts,
regression guards, and local or SSH target orchestration. Runtime code is
ESM-only and uses Node.js built-ins.

## Install

```bash
pnpm add -D @swarmmachina/benchkit
```

## HTTP/1 load generation

`runHttp1Load()` runs persistent worker threads and keep-alive connections. It
supports pipelining, same-connection warmup, closed-loop saturation, fixed-rate
scheduling, coordinated-omission correction, socket backpressure, HTTP and
HTTPS, and bounded latency recording.

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

console.log({
  rps: result.requests.averagePerSecond,
  p95Ms: result.latencyMs.p95Ms,
  p99Ms: result.latencyMs.p99Ms,
  cpuPct: result.loadGenerator.cpuCorePct,
  eluPct: result.loadGenerator.maxWorkerEluPct,
  dropped: result.transport.rateDropped,
  errors: result.errors.total
})
```

Omit `rate` for closed-loop saturation. Set an aggregate rate for open
scheduling:

```ts
const result = await runHttp1Load({
  url: 'https://127.0.0.1:3443/',
  connections: 100,
  pipelining: 10,
  workers: 4,
  rate: 50_000,
  correctCoordinatedOmission: true,
  durationMs: 10_000
})
```

Requests that cannot fit within connection and pipeline capacity are counted in
`result.transport.rateDropped`; they are never queued into an unbounded backlog.
Fixed-rate latency includes scheduling delay by default. Set
`correctCoordinatedOmission: false` to measure from the actual socket write.

Warmup and measurement use the same workers and sockets. Workers drain
outstanding warmup responses and reset counters before measurement, preserving
connection and JIT state.

### Result groups

| Group           | Contents                                                               |
| --------------- | ---------------------------------------------------------------------- |
| `parameters`    | Effective URL, method, mode, concurrency, rate, and timing             |
| `requests`      | Sent/completed requests, RPS, bytes written, and bytes read            |
| `latencyMs`     | Average and bounded nearest-rank p50/p95/p97.5/p99 latency             |
| `statusCodes`   | Response counts grouped by HTTP status                                 |
| `errors`        | Connection, timeout, protocol, and aborted-request counters            |
| `transport`     | Write batching, backpressure, drain time, dropped rate, scheduling lag |
| `loadGenerator` | Process CPU, worker ELU, worker memory, and process-memory peaks       |

`loadGenerator.cpuCorePct` uses 100% for one fully occupied CPU core.
Generator process CPU and RSS include unrelated work in the caller process; run
the target in another process or host when those values must be isolated.

Supported response framing includes `Content-Length`,
`Transfer-Encoding: chunked`, interim 1xx responses, HEAD, 204, and 304.
Close-delimited responses and HTTP upgrades are rejected because they cannot
safely sustain HTTP/1.1 pipelining.

The complete option and result contracts are documented in the published
TypeScript declarations and appear directly in editor hover and completion.

## WebSocket load generation

`runWebSocketLoad()` uses the native WebSocket client shipped with Node.js 22
and 24. It adds no `ws` runtime dependency. Persistent connections run in
worker threads and support bounded closed-loop saturation, fixed aggregate
rates, warmup, send-buffer backpressure, and generator CPU/ELU/memory metrics.

The target must behave as an echo/request-response endpoint: every received
application message completes the oldest in-flight send on that connection.
Unsolicited application messages are reported as protocol errors.

```ts
import { runWebSocketLoad } from '@swarmmachina/benchkit/load/websocket'

const result = await runWebSocketLoad({
  url: 'ws://127.0.0.1:3000/echo',
  message: '{"type":"ping"}',
  connections: 100,
  maxInFlight: 4,
  workers: 4,
  warmupMs: 2_000,
  durationMs: 10_000
})

console.log({
  messagesPerSecond: result.messages.averagePerSecond,
  p95Ms: result.latencyMs.p95Ms,
  p99Ms: result.latencyMs.p99Ms,
  eluPct: result.loadGenerator.maxWorkerEluPct,
  rssPeakBytes: result.loadGenerator.processMemory.rss.peakBytes,
  dropped: result.transport.rateDropped,
  errors: result.errors.total
})
```

Set `rate` for fixed-rate scheduling. Arrivals are dropped rather than queued
when `connections * maxInFlight` is exhausted or native `bufferedAmount`
exceeds `maxBufferedBytes`.

Run the included benchmark against an echo endpoint:

```bash
BENCHKIT_WS_URL=ws://127.0.0.1:3000/echo \
BENCHKIT_WS_CONNECTIONS=100 \
BENCHKIT_WS_MAX_IN_FLIGHT=4 \
BENCHKIT_WS_DURATION_MS=10000 \
pnpm bench:websocket-load
```

The command prints the effective connections, duration, in-flight limit,
workers, message size, and optional rate together with throughput, p95/p99,
ELU, CPU, RSS, backpressure, dropped arrivals, and errors.

## Measurement

Use the package root for the common API or a domain subpath for a narrower
surface.

```ts
import { BoundedLatencyRecorder, measureBatch } from '@swarmmachina/benchkit/measurement'

const latency = new BoundedLatencyRecorder({
  lowestDiscernibleMs: 0.001,
  highestTrackableMs: 60_000,
  relativeAccuracy: 0.01
})

const measured = await measureBatch({
  operations: 10_000,
  run: async () => {
    await runScenario((durationMs) => latency.record(durationMs))
    return latency.snapshot()
  }
})

console.log(measured.operationsPerSecond, measured.latencyMs.p99)
```

The logarithmic histogram records in O(1) time, keeps memory bounded, merges
worker snapshots without transferring raw samples, and declares its maximum
relative error. Raw latency arrays remain supported when exact nearest-rank
results are required.

## Target orchestration

`TargetProvider` runs the same short-lived control agent locally or
over SSH. Load traffic connects directly to the target; it never passes through
the control channel.

```ts
import { TargetProvider } from '@swarmmachina/benchkit'

const provider = new TargetProvider({
  mode: 'local',
  cwd: process.cwd()
})

const session = await provider.start({
  entrypoint: './benchmark/server.js',
  args: ['--test', 'base-sync'],
  port: { range: [30_000, 30_100] }
})

try {
  await session.waitReachable()
  await session.startMetrics({ sampleMs: 250 })

  // Run the protocol-specific load here.

  const metrics = await session.stopMetrics()
  console.log(metrics)
} finally {
  await session.stop()
}
```

The target process integrates through `TargetRuntime` from
`@swarmmachina/benchkit/target`. Target lifecycle is explicit:

```text
starting -> ready -> measuring -> ready -> stopping -> stopped
     |         |          |          |          |
     +---------+----------+----------+----------+-> failed
```

Startup, reachability, command, graceful-shutdown, and force-kill deadlines are
independent. Local targets may collect CPU profiles; remote profiling is
rejected before an SSH process is started.

## Package surfaces

| Subpath           | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `measurement`     | Latency, throughput, ELU, memory, and scenario measurements      |
| `load/http1`      | HTTP/1.1 load generation and generator-health metrics            |
| `load/websocket`  | Native WebSocket load generation and generator-health metrics    |
| `control`         | Versioned control protocol, state machine, and structured errors |
| `target`          | Target-process runtime integration                               |
| `target-provider` | Local and SSH target sessions                                    |
| `orchestration`   | Process, scheduling, argument, directory, and port helpers       |
| `profiling`       | V8 CPU and heap-allocation profile processing                    |
| `regression`      | Absolute and relative metric or CPU regression guards            |
| `reporting`       | Markdown tables, formatting, and GitHub step summaries           |
| `results`         | Typed benchmark results and versioned artifacts                  |
| `statistics`      | Quantiles, medians, paired comparisons, and percentage deltas    |
| `units`           | Shared unit conversions                                          |

Legacy function-level imports such as `@swarmmachina/benchkit/metrics` and
`@swarmmachina/benchkit/get-free-port` remain explicit package exports. The
physical `dist/` layout is not public API.

Every published type, interface, class, property, and method is documented in
the generated declarations. `pnpm run check:type-docs` resolves the public
surface from `package.json#exports` and rejects undocumented type contracts.
The package-level declaration entrypoint is emitted as `dist/types.d.ts`;
domain declarations remain colocated below `dist/`.

## Runtime design

- No runtime dependencies.
- Native ESM on Node.js 22 and 24.
- HTTP workers own fixed connection shares and return bounded counters and
  histograms instead of raw request samples.
- The HTTP parser performs byte-level message framing and does not retain
  response bodies.
- Socket write batching and explicit `drain` handling keep backpressure visible.
- Fixed-rate overload drops arrivals and reports them instead of growing memory.
- Target control uses bounded NDJSON over stdio and Node IPC.
- Benchmark artifacts include a versioned schema and a host/runtime environment
  snapshot.

## Local capacity check

The smoke command starts a fixed-response `node:http` target and the generator
on the same machine:

```bash
BENCHKIT_HTTP_CONNECTIONS=100 \
BENCHKIT_HTTP_PIPELINING=10 \
BENCHKIT_HTTP_DURATION_MS=2000 \
BENCHKIT_HTTP_WARMUP_MS=500 \
BENCHKIT_HTTP_WORKERS=4 \
pnpm run bench:http1-load
```

Add `BENCHKIT_HTTP_RATE=50000` for fixed-rate scheduling. Use separate target
and generator hosts for publishable comparisons.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run release:gate
```

Useful focused commands:

```bash
pnpm run check
pnpm run test
pnpm run test:unit
pnpm run test:integration
pnpm run test:packed-types
pnpm run test:ssh-smoke
pnpm run bench:http1-load
```

The release gate formats and type-checks the source, runs unit and integration
tests, builds the package, packs it, and compiles a real consumer under both
NodeNext and Bundler module resolution.

### SSH smoke

Requirements: Node.js 22 or 24, `tar`, key-based SSH, and a target port
reachable from the workstation.

```bash
BENCHKIT_SSH_DESTINATION=bench@target.example \
BENCHKIT_SSH_CONNECT_HOST=192.0.2.10 \
pnpm run test:ssh-smoke
```

Use `pnpm run test:ssh-soak` for lifecycle, metrics, failures, timeouts,
forced shutdown, diagnostics, and concurrency.

| Variable                        | Default | Purpose                       |
| ------------------------------- | ------- | ----------------------------- |
| `BENCHKIT_SSH_DESTINATION`      | —       | SSH control endpoint          |
| `BENCHKIT_SSH_CONNECT_HOST`     | —       | Host used by direct load      |
| `BENCHKIT_SSH_REMOTE_BASE`      | `/tmp`  | Remote staging directory      |
| `BENCHKIT_SSH_KEEP_REMOTE=1`    | off     | Keep staging files for debug  |
| `BENCHKIT_SSH_SOAK_ITERATIONS`  | `20`    | Total lifecycle sessions      |
| `BENCHKIT_SSH_SOAK_CONCURRENCY` | `4`     | Concurrent lifecycle sessions |
| `BENCHKIT_SSH_SOAK_METRICS_MS`  | `100`   | Metrics window per session    |

Configure keys, ports, and jump hosts in `~/.ssh/config`. The command builds,
stages, tests, and cleans up automatically.

## License

[MPL-2.0](./LICENSE)
