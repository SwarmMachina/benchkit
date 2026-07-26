import { aggregateLoadPhase } from '../shared/aggregate-load-phase.js'
import { normalizeWebSocketLoadOptions } from './normalize-websocket-load-options.js'
import type { WebSocketLoadPhaseResult } from './websocket-load-context.js'
import { WebSocketLoadCoordinator } from './websocket-load-coordinator.js'
import type { RunWebSocketLoadOptions, WebSocketLoadParameters, WebSocketLoadResult } from './types.js'

/**
 * Runs a native Node.js WebSocket echo/request-response load scenario.
 *
 * Each received application message completes the oldest in-flight send on the
 * same connection. The endpoint must therefore emit exactly one response for
 * each load message and must not interleave unsolicited application messages.
 * @param options Target, payload, concurrency, scheduling, and measurement options.
 * @returns Throughput, bounded latency, error, transport, CPU, ELU, and memory measurements.
 * @throws {TypeError} If an option has an invalid type or the URL is unsupported.
 * @throws {RangeError} If a numeric option is outside its supported range.
 * @example
 * ```ts
 * const result = await runWebSocketLoad({
 *   url: 'ws://127.0.0.1:3000/echo',
 *   message: '{"type":"ping"}',
 *   connections: 100,
 *   maxInFlight: 4,
 *   durationMs: 10_000
 * })
 * ```
 */
export default async function runWebSocketLoad(options: RunWebSocketLoadOptions): Promise<WebSocketLoadResult> {
  const normalized = normalizeWebSocketLoadOptions(options)
  const phase = await new WebSocketLoadCoordinator(normalized).run()

  return aggregateResult(normalized.parameters, phase)
}

function aggregateResult(parameters: WebSocketLoadParameters, phase: WebSocketLoadPhaseResult): WebSocketLoadResult {
  const aggregated = aggregateLoadPhase(phase)

  return {
    parameters,
    startedAt: aggregated.startedAt,
    finishedAt: aggregated.finishedAt,
    durationMs: aggregated.durationMs,
    messages: {
      sent: aggregated.operations.sent,
      received: aggregated.operations.completed,
      averagePerSecond: aggregated.operations.averagePerSecond,
      payloadBytesSent: aggregated.operations.bytesSent,
      payloadBytesReceived: aggregated.operations.bytesReceived
    },
    latencyMs: aggregated.latencyMs,
    latencySnapshot: aggregated.latencySnapshot,
    errors: {
      connection: aggregated.errors.connection,
      timeout: aggregated.errors.timeout,
      protocol: aggregated.errors.protocol,
      abortedMessages: aggregated.errors.aborted,
      total: aggregated.errors.total
    },
    transport: aggregated.transport,
    loadGenerator: {
      ...aggregated.loadGenerator,
      cpuPerMillionMessagesMs:
        aggregated.operations.completed > 0
          ? (aggregated.loadGenerator.cpuMs / aggregated.operations.completed) * 1_000_000
          : null
    }
  }
}
