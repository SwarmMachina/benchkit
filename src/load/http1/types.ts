import type { BoundedLatencySnapshot, BoundedLatencySummary } from '../../measurement/bounded-latency-recorder.js'
import type { ProcessMemorySummary } from '../../measurement/process-memory.js'

/** A request-header value accepted by {@link RunHttp1LoadOptions.headers}. */
export type Http1HeaderValue = string | readonly string[]

/**
 * The scheduling model used by {@link runHttp1Load}.
 *
 * `closed-loop` replenishes a request after a response completes.
 * `fixed-rate` schedules requests against an absolute monotonic timeline.
 */
export type Http1LoadMode = 'closed-loop' | 'fixed-rate'

/** TLS options applied to each HTTPS connection. */
export interface Http1TlsOptions {
  /** PEM-encoded trusted certificates. Uses Node.js defaults when omitted. */
  ca?: string | Buffer | readonly (string | Buffer)[]

  /** PEM-encoded certificate chain sent to the server. */
  cert?: string | Buffer | readonly (string | Buffer)[]

  /** PEM-encoded private key associated with {@link Http1TlsOptions.cert}. */
  key?: string | Buffer | readonly (string | Buffer)[]

  /**
   * Enables server-certificate verification.
   * @default `true`
   */
  rejectUnauthorized?: boolean

  /** TLS server name used for SNI and certificate identity checks. */
  servername?: string
}

/** Options accepted by {@link runHttp1Load}. */
export interface RunHttp1LoadOptions {
  /**
   * HTTP or HTTPS target.
   *
   * URL credentials and fragments are rejected. Use an `Authorization` header
   * for credentials.
   */
  url: string | URL

  /**
   * Stable scenario name copied to the result.
   * @default The upper-case method followed by the URL pathname.
   */
  name?: string

  /**
   * HTTP request method.
   * @default `'GET'`
   */
  method?: string

  /**
   * Request headers.
   *
   * Header names are validated case-insensitively. Multiple values are emitted
   * as separate fields.
   */
  headers?: Readonly<Record<string, Http1HeaderValue>>

  /** Request body encoded once and reused by every request. */
  body?: string | Uint8Array

  /**
   * Total persistent connections shared across workers.
   * @default `10`
   */
  connections?: number

  /**
   * Maximum requests in flight on each connection.
   * @default `1`
   */
  pipelining?: number

  /**
   * Worker threads used by the generator.
   * @default The smallest of `4`, available parallelism, and
   * {@link RunHttp1LoadOptions.connections}.
   */
  workers?: number

  /**
   * Aggregate requests scheduled per second.
   *
   * Omit this option for closed-loop saturation. In fixed-rate mode, arrivals
   * that cannot fit within connection and pipeline capacity are counted in
   * {@link Http1LoadTransportMetrics.rateDropped} instead of being queued.
   */
  rate?: number

  /**
   * Starts fixed-rate latency at the intended schedule time.
   *
   * This includes generator scheduling delay and avoids coordinated omission.
   * The option is valid only when {@link RunHttp1LoadOptions.rate} is set.
   * @default `true` in fixed-rate mode.
   */
  correctCoordinatedOmission?: boolean

  /**
   * Measurement duration in milliseconds.
   * @default `10_000`
   */
  durationMs?: number

  /**
   * Warmup duration in milliseconds.
   *
   * Warmup uses the same workers and sockets as measurement. Outstanding
   * responses are drained and counters are reset at the phase boundary.
   * @default `0`
   */
  warmupMs?: number

  /**
   * Per-request inactivity timeout in milliseconds.
   * @default `10_000`
   */
  timeoutMs?: number

  /**
   * Maximum time for all workers to establish their connections.
   * @default `10_000`
   */
  startupTimeoutMs?: number

  /**
   * Generator process-memory sampling interval in milliseconds.
   * @default `50`
   */
  memorySampleMs?: number

  /**
   * Maximum response-header block size in bytes.
   * @default `65_536`
   */
  maxHeaderBytes?: number

  /**
   * Unix-domain socket path.
   *
   * When set, the URL still supplies the HTTP path and `Host` header.
   */
  socketPath?: string

  /** TLS options used only for an `https:` URL. */
  tls?: Http1TlsOptions

  /** Aborts startup, warmup, or measurement and terminates all workers. */
  signal?: AbortSignal
}

/** Effective configuration used for one completed HTTP/1 load run. */
export interface Http1LoadParameters {
  /** Stable scenario name. */
  name: string

  /** Normalized absolute target URL. */
  url: string

  /** Upper-case request method. */
  method: string

  /** Total persistent connections. */
  connections: number

  /** Maximum requests in flight per connection. */
  pipelining: number

  /** Number of worker threads. */
  workers: number

  /** Effective request scheduling model. */
  mode: Http1LoadMode

  /** Aggregate fixed rate, or `null` in closed-loop mode. */
  rate: number | null

  /** Whether fixed-rate latency includes intended scheduling delay. */
  correctCoordinatedOmission: boolean

  /** Requested measurement duration in milliseconds. */
  durationMs: number

  /** Requested warmup duration in milliseconds. */
  warmupMs: number

  /** Per-request inactivity timeout in milliseconds. */
  timeoutMs: number
}

/** Request and byte counters for the measurement phase. */
export interface Http1LoadRequestMetrics {
  /** Requests accepted by a socket write. */
  sent: number

  /** Complete HTTP responses parsed. */
  completed: number

  /** Completed requests divided by actual measurement wall time. */
  averagePerSecond: number

  /** Serialized request bytes passed to sockets. */
  bytesWritten: number

  /** Response bytes received from sockets. */
  bytesRead: number
}

/** Errors observed during the measurement phase. */
export interface Http1LoadErrorMetrics {
  /** Socket connection or unexpected-disconnection errors. */
  connection: number

  /** Request inactivity timeouts. */
  timeout: number

  /** Unsupported or malformed HTTP response framing. */
  protocol: number

  /** In-flight requests lost when a connection closed. */
  abortedRequests: number

  /** Sum of connection, timeout, protocol, and aborted-request counters. */
  total: number
}

/** Generator-side CPU, event-loop, and memory measurements. */
export interface Http1LoadGeneratorMetrics {
  /** CPU time consumed by the caller process during measurement. */
  cpuMs: number

  /**
   * Caller-process CPU divided by measurement wall time.
   *
   * `100` represents one fully occupied CPU core.
   */
  cpuCorePct: number

  /** CPU milliseconds per one million completed responses, or `null` with no responses. */
  cpuPerMillionRequestsMs: number | null

  /** Event-loop utilization of the coordinator thread. */
  parentEluPct: number

  /** Highest event-loop utilization among worker threads. */
  maxWorkerEluPct: number

  /** Arithmetic mean event-loop utilization across worker threads. */
  meanWorkerEluPct: number

  /** Sum of worker-local peak V8 heap usage. */
  workerHeapUsedPeakBytes: number

  /** Sum of worker-local peak external memory. */
  workerExternalPeakBytes: number

  /** Sum of worker-local peak `ArrayBuffer` memory. */
  workerArrayBuffersPeakBytes: number

  /**
   * Caller-process memory measurements, including worker threads.
   *
   * Unrelated work in the caller process is included.
   */
  processMemory: ProcessMemorySummary

  /** Whether any worker reached the generator ELU saturation threshold. */
  saturated: boolean
}

/** Socket, scheduling, and overload measurements. */
export interface Http1LoadTransportMetrics {
  /** Calls made to `socket.write()`. */
  socketWriteCalls: number

  /** Requests batched per socket write, or `null` when nothing was written. */
  requestsPerSocketWrite: number | null

  /** Number of writes that returned `false`. */
  backpressureEvents: number

  /** Aggregate time spent waiting for socket `drain`, in milliseconds. */
  drainWaitMs: number

  /** Requests still in flight when the measurement phase stopped. */
  inFlightAtStop: number

  /**
   * Fixed-rate arrivals dropped because no pipeline capacity was available.
   *
   * This is always `0` in closed-loop mode.
   */
  rateDropped: number

  /** Mean delay from intended schedule time to actual write, or `null` without scheduled requests. */
  meanScheduleLagMs: number | null

  /** Maximum delay from intended schedule time to actual write. */
  maxScheduleLagMs: number
}

/** Complete result returned by {@link runHttp1Load}. */
export interface Http1LoadResult {
  /** Effective normalized configuration. */
  parameters: Http1LoadParameters

  /** ISO-8601 timestamp immediately before measurement started. */
  startedAt: string

  /** ISO-8601 timestamp after all workers completed measurement. */
  finishedAt: string

  /** Actual measurement wall time in milliseconds. */
  durationMs: number

  /** Request throughput and byte counters. */
  requests: Http1LoadRequestMetrics

  /** Bounded latency summary in milliseconds. */
  latencyMs: BoundedLatencySummary

  /** Mergeable bounded latency histogram snapshot. */
  latencySnapshot: BoundedLatencySnapshot

  /** Completed responses grouped by decimal HTTP status code. */
  statusCodes: Record<string, number>

  /** Completed responses outside the 200–299 range. */
  non2xx: number

  /** Error counters. */
  errors: Http1LoadErrorMetrics

  /** Socket, scheduling, and overload measurements. */
  transport: Http1LoadTransportMetrics

  /** Generator-side CPU, event-loop, and memory measurements. */
  loadGenerator: Http1LoadGeneratorMetrics
}
