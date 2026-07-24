# HTTP/1 load generator

`runHttp1Load()` is a closed-loop, zero-runtime-dependency HTTP/1.1 load
generator. It is intentionally available only from
`@swarmmachina/benchkit/load/http1`; the package root and transport-neutral
measurement modules do not import it.

## Components and boundaries

- The coordinator validates configuration, runs discarded warmup and measured
  phases, samples process memory and merges worker results.
- Each worker owns a fixed share of the configured connections and records its
  own ELU, memory peaks, counters and bounded latency histogram.
- Each connection owns one `node:net` or `node:tls` socket, a fixed-size FIFO of
  request timestamps and one streaming response parser.
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
  generatorRssPeak: result.loadGenerator.processMemory.rss.peakBytes
})
```

Warmup uses the same connection, pipeline and worker topology as the measured
phase. Its sockets and measurements are discarded before the measured phase
starts.

## Measurement semantics

- The generator is closed-loop: every completed response releases one new
  request on the same connection.
- Latency starts immediately before a request is written and ends when its
  complete response has been parsed. HTTP/1.1 head-of-line blocking is therefore
  included when pipelining is greater than one.
- Worker histograms use Benchkit's mergeable bounded recorder. Results expose
  p50, p95, p97.5 and p99 with the recorder's declared maximum relative error.
- `maxWorkerEluPct` is the highest measured worker ELU. `saturated` becomes true
  at 95%, indicating that the generator may be limiting throughput.
- Process RSS is sampled in the coordinator and includes the worker threads.
  Worker heap, external and array-buffer peaks are summed across workers; their
  individual peaks are not guaranteed to have occurred at the same instant.
- Unexpected disconnects are retried. Requests still in the connection FIFO are
  counted as `abortedRequests`.

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
- fixed/open request-rate scheduling and coordinated-omission correction are not
  part of the closed-loop API
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

The smoke command runs the generator and a fixed-response `node:http` server on
the same machine. It reports RPS, p95, p99, maximum worker ELU, process RSS peak
and errors. Use a separate generator host for publishable server comparisons.
