# HTTP/1 load generator

`runHttp1Load()` is a zero-runtime-dependency HTTP/1.1 load generator with
closed-loop and fixed-rate scheduling. It is intentionally available only from
`@swarmmachina/benchkit/load/http1`; the package root and transport-neutral
measurement modules do not import it.

## Components and boundaries

- The coordinator validates configuration, advances persistent workers through
  warmup and measurement, samples process CPU/memory and merges worker results.
- Each worker owns a fixed share of the configured connections and records its
  own ELU, memory peaks, counters and bounded latency histogram.
- Each connection owns one `node:net` or `node:tls` socket, a fixed-size FIFO of
  request timestamps, backpressure state and one streaming response parser.
- The scheduler either refills completed closed-loop requests or distributes an
  aggregate fixed rate across workers and available connection capacity.
- The parser owns HTTP message framing only. It does not retain response bodies
  or expose application-level response hooks.
- Target process ELU and memory remain the responsibility of `TargetSession`;
  the load result reports generator-side health separately.

Load traffic flows directly from workers to the target. Worker results contain
bounded histograms and counters rather than raw latency samples.

## Usage

```ts
import { runHttp1Load } from '@swarmmachina/benchkit/load/http1'

const result = await runHttp1Load({
  name: 'base-sync',
  url: 'http://127.0.0.1:3000/base-sync',
  connections: 100,
  pipelining: 10,
  workers: 4,
  warmupMs: 2_000,
  durationMs: 10_000,
  memorySampleMs: 25
})

console.log({
  rps: result.requests.averagePerSecond,
  averageMs: result.latencyMs.averageMs,
  p95Ms: result.latencyMs.p95Ms,
  p99Ms: result.latencyMs.p99Ms,
  generatorEluPct: result.loadGenerator.maxWorkerEluPct,
  generatorCpuPct: result.loadGenerator.cpuCorePct,
  backpressure: result.transport.backpressureEvents,
  generatorRssPeak: result.loadGenerator.processMemory.rss.peakBytes
})
```

Warmup and measurement run in the same workers over the same sockets. At the
warmup boundary, workers stop scheduling, drain outstanding responses, reset
counters/histograms and begin measurement without discarding JIT or connection
state.

Fixed aggregate rate:

```ts
const result = await runHttp1Load({
  url: 'http://127.0.0.1:3000/base-sync',
  connections: 100,
  pipelining: 10,
  workers: 4,
  rate: 50_000,
  correctCoordinatedOmission: true,
  durationMs: 10_000
})
```

## Measurement semantics

- Without `rate`, every completed response releases one new request on the same
  connection.
- With `rate`, requests are scheduled against an absolute monotonic timeline.
  The rate is aggregate across workers. Requests that cannot fit within
  connection/pipeline capacity are counted as `transport.rateDropped`; increase
  connections/pipelining or reduce the rate when this is non-zero.
- Coordinated-omission correction is enabled by default in fixed-rate mode:
  latency starts at the intended schedule time, so scheduler delay is included.
  Set `correctCoordinatedOmission: false` to measure from the actual write time.
- Latency starts immediately before a request is written and ends when its
  complete response has been parsed. HTTP/1.1 head-of-line blocking is therefore
  included when pipelining is greater than one.
- Worker histograms use Benchkit's mergeable bounded recorder. Results expose
  p50, p95, p97.5 and p99 with the recorder's declared maximum relative error.
- `maxWorkerEluPct` is the highest measured worker ELU. `saturated` becomes true
  at 95%, indicating that the generator may be limiting throughput.
- `cpuCorePct` is process CPU divided by measured wall time; 100% represents one
  fully occupied core. `cpuPerMillionRequestsMs` makes generator efficiency
  comparable across throughput levels.
- Process RSS is sampled in the coordinator and includes the worker threads.
  Worker heap, external and array-buffer peaks are summed across workers; their
  individual peaks are not guaranteed to have occurred at the same instant.
- Unexpected disconnects are retried. Requests still in the connection FIFO are
  counted as `abortedRequests`.
- A false `socket.write()` result pauses further writes until `drain`.
  `backpressureEvents`, `drainWaitMs`, `socketWriteCalls`,
  `requestsPerSocketWrite` and `inFlightAtStop` expose transport health.

Process CPU covers the entire caller process, including unrelated work on its
main thread. Run the target in another process or host for generator-only CPU.

## HTTP support

Supported response framing:

- HTTP/1.0 and HTTP/1.1 status lines
- interim 1xx responses other than protocol upgrade
- `Content-Length`
- `Transfer-Encoding: chunked`, including trailers
- bodyless HEAD, 204 and 304 responses

Deliberate limits:

- close-delimited responses are rejected because they cannot safely sustain
  pipelining
- HTTP upgrades and WebSocket are separate protocols
- request-side chunked encoding is not supported
- per-request mutation, HAR, multipart and rich CLI rendering remain out of scope

TLS certificate verification follows Node defaults. Tests using private
certificates must opt out explicitly with `tls.rejectUnauthorized: false`.

## Local capacity smoke benchmark

```bash
BENCHKIT_HTTP_CONNECTIONS=100 \
BENCHKIT_HTTP_PIPELINING=10 \
BENCHKIT_HTTP_DURATION_MS=2000 \
BENCHKIT_HTTP_WARMUP_MS=500 \
BENCHKIT_HTTP_WORKERS=4 \
pnpm run bench:http1-load
```

Add `BENCHKIT_HTTP_RATE=50000` to exercise fixed-rate mode.

The smoke command runs the generator and a fixed-response `node:http` server on
the same machine. It reports RPS, p95, p99, CPU, maximum worker ELU, process RSS,
write batching, backpressure, dropped rate and errors. Use a separate generator
host for publishable server comparisons.
