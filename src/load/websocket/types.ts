import type { BoundedLatencySnapshot, BoundedLatencySummary } from '../../measurement/bounded-latency-recorder.js'
import type { ProcessMemorySummary } from '../../measurement/process-memory.js'

/** The scheduling model used by {@link runWebSocketLoad}. */
export type WebSocketLoadMode = 'closed-loop' | 'fixed-rate'

/** Options accepted by {@link runWebSocketLoad}. */
export interface RunWebSocketLoadOptions {
  /** Absolute `ws:` or `wss:` echo/request-response endpoint. */
  url: string | URL

  /** Stable scenario name copied to the result. */
  name?: string

  /**
   * Payload sent for every request.
   * @default `'ping'`
   */
  message?: string | Uint8Array

  /** WebSocket subprotocol or ordered subprotocol preference list. */
  protocols?: string | readonly string[]

  /**
   * Total persistent WebSocket connections shared across workers.
   * @default `10`
   */
  connections?: number

  /**
   * Maximum unanswered messages on each connection.
   * @default `1`
   */
  maxInFlight?: number

  /**
   * Worker threads used by the generator.
   * @default The smallest of `4`, available parallelism, and
   * {@link RunWebSocketLoadOptions.connections}.
   */
  workers?: number

  /**
   * Aggregate messages scheduled per second.
   *
   * Omit for closed-loop saturation. Arrivals without available in-flight or
   * transport capacity are counted in
   * {@link WebSocketLoadTransportMetrics.rateDropped}.
   */
  rate?: number

  /**
   * Starts fixed-rate latency at the intended schedule time.
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
   * @default `0`
   */
  warmupMs?: number

  /**
   * Maximum time an oldest unanswered message may remain in flight.
   * @default `10_000`
   */
  timeoutMs?: number

  /**
   * Maximum time for all workers to establish their initial connections.
   * @default `10_000`
   */
  startupTimeoutMs?: number

  /**
   * Generator process-memory sampling interval in milliseconds.
   * @default `50`
   */
  memorySampleMs?: number

  /**
   * Per-connection native `WebSocket.bufferedAmount` high-water mark.
   *
   * Closed-loop sends pause above the mark. Fixed-rate arrivals are dropped
   * while above the mark.
   * @default `1_048_576`
   */
  maxBufferedBytes?: number

  /** Aborts startup, warmup, or measurement and terminates all workers. */
  signal?: AbortSignal
}

/** Effective configuration used for one completed WebSocket load run. */
export interface WebSocketLoadParameters {
  /** Stable scenario name. */
  name: string

  /** Normalized absolute target URL. */
  url: string

  /** Text or binary payload kind. */
  messageType: 'text' | 'binary'

  /** Payload size before WebSocket framing. */
  messageBytes: number

  /** Ordered WebSocket subprotocol preferences. */
  protocols: readonly string[]

  /** Total persistent connections. */
  connections: number

  /** Maximum unanswered messages per connection. */
  maxInFlight: number

  /** Number of worker threads. */
  workers: number

  /** Effective scheduling model. */
  mode: WebSocketLoadMode

  /** Aggregate fixed rate, or `null` in closed-loop mode. */
  rate: number | null

  /** Whether fixed-rate latency includes intended scheduling delay. */
  correctCoordinatedOmission: boolean

  /** Requested measurement duration in milliseconds. */
  durationMs: number

  /** Requested warmup duration in milliseconds. */
  warmupMs: number

  /** Oldest unanswered-message timeout in milliseconds. */
  timeoutMs: number

  /** Native send-buffer high-water mark per connection. */
  maxBufferedBytes: number
}

/** Message throughput and application-payload byte counters. */
export interface WebSocketLoadMessageMetrics {
  /** Messages passed to native `WebSocket.send()`. */
  sent: number

  /** Messages received and matched to an in-flight send. */
  received: number

  /** Received messages divided by actual measurement wall time. */
  averagePerSecond: number

  /** Payload bytes passed to `WebSocket.send()`, excluding framing. */
  payloadBytesSent: number

  /** Received payload bytes, excluding framing. */
  payloadBytesReceived: number
}

/** Errors observed during the measurement phase. */
export interface WebSocketLoadErrorMetrics {
  /** Handshake, transport, or unexpected-close errors. */
  connection: number

  /** Oldest in-flight message timeouts. */
  timeout: number

  /** Unmatched or unsupported received messages. */
  protocol: number

  /** In-flight messages lost when a connection was discarded. */
  abortedMessages: number

  /** Sum of all error counters. */
  total: number
}

/** Native WebSocket transport and fixed-rate scheduler metrics. */
export interface WebSocketLoadTransportMetrics {
  /** Calls made to native `WebSocket.send()`. */
  sendCalls: number

  /** Times `bufferedAmount` crossed above the configured high-water mark. */
  backpressureEvents: number

  /** Aggregate time spent above the send-buffer high-water mark. */
  backpressureWaitMs: number

  /** Largest sampled native `bufferedAmount`. */
  bufferedAmountPeakBytes: number

  /** Messages still in flight when measurement stopped. */
  inFlightAtStop: number

  /** Fixed-rate arrivals dropped because no bounded capacity was available. */
  rateDropped: number

  /** Mean intended-schedule-to-send delay, or `null` without scheduled sends. */
  meanScheduleLagMs: number | null

  /** Maximum intended-schedule-to-send delay. */
  maxScheduleLagMs: number
}

/** Generator-side CPU, event-loop, and memory measurements. */
export interface WebSocketLoadGeneratorMetrics {
  /** CPU time consumed by the caller process during measurement. */
  cpuMs: number

  /** Caller-process CPU divided by wall time; `100` is one occupied core. */
  cpuCorePct: number

  /** CPU milliseconds per one million received messages. */
  cpuPerMillionMessagesMs: number | null

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

  /** Caller-process memory measurements, including worker threads. */
  processMemory: ProcessMemorySummary

  /** Whether any worker reached the generator ELU saturation threshold. */
  saturated: boolean
}

/** Complete result returned by {@link runWebSocketLoad}. */
export interface WebSocketLoadResult {
  /** Effective normalized configuration. */
  parameters: WebSocketLoadParameters

  /** ISO-8601 timestamp immediately before measurement started. */
  startedAt: string

  /** ISO-8601 timestamp after all workers completed measurement. */
  finishedAt: string

  /** Actual measurement wall time in milliseconds. */
  durationMs: number

  /** Message throughput and payload byte counters. */
  messages: WebSocketLoadMessageMetrics

  /** Bounded request-response latency summary in milliseconds. */
  latencyMs: BoundedLatencySummary

  /** Mergeable bounded latency histogram snapshot. */
  latencySnapshot: BoundedLatencySnapshot

  /** Error counters. */
  errors: WebSocketLoadErrorMetrics

  /** Native transport and scheduler counters. */
  transport: WebSocketLoadTransportMetrics

  /** Generator-side CPU, event-loop, and memory measurements. */
  loadGenerator: WebSocketLoadGeneratorMetrics
}
