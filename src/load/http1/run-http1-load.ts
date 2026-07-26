import { aggregateLoadPhase } from '../shared/aggregate-load-phase.js'
import { Http1LoadCoordinator } from './http1-load-coordinator.js'
import type { Http1LoadPhaseResult } from './http1-load-context.js'
import { normalizeHttp1LoadOptions } from './normalize-http1-load-options.js'
import type { Http1LoadParameters, Http1LoadResult, RunHttp1LoadOptions } from './types.js'

/**
 * Runs an HTTP/1.1 load scenario and resolves with bounded measurements.
 *
 * Workers and connections are created once. An optional warmup phase drains
 * outstanding responses and resets measurements without discarding socket or
 * JIT state. The target should run in a separate process or host when
 * generator CPU and memory must exclude target work.
 * @param options Target, concurrency, scheduling, and measurement options.
 * @returns Throughput, latency, status, error, transport, CPU, ELU, and memory
 * measurements.
 * @throws {TypeError} If an option has an invalid type or the URL is unsupported.
 * @throws {RangeError} If a numeric option is outside its supported range.
 * @example Closed-loop saturation:
 * ```ts
 * const result = await runHttp1Load({
 *   url: 'http://127.0.0.1:3000/',
 *   connections: 100,
 *   pipelining: 10,
 *   durationMs: 10_000
 * })
 * ```
 * @example Fixed aggregate rate:
 * ```ts
 * const result = await runHttp1Load({
 *   url: 'http://127.0.0.1:3000/',
 *   connections: 100,
 *   rate: 50_000,
 *   durationMs: 10_000
 * })
 * ```
 */
export default async function runHttp1Load(options: RunHttp1LoadOptions): Promise<Http1LoadResult> {
  const normalized = normalizeHttp1LoadOptions(options)
  const phase = await new Http1LoadCoordinator(normalized).run()

  return aggregateResult(normalized.parameters, phase)
}

function aggregateResult(parameters: Http1LoadParameters, phase: Http1LoadPhaseResult): Http1LoadResult {
  const aggregated = aggregateLoadPhase(phase)
  const statusCodes: Record<string, number> = {}

  let non2xx = 0

  for (const worker of phase.workers) {
    non2xx += worker.non2xx

    for (const [statusCode, count] of Object.entries(worker.statusCodes)) {
      statusCodes[statusCode] = (statusCodes[statusCode] ?? 0) + count
    }
  }

  return {
    parameters,
    startedAt: aggregated.startedAt,
    finishedAt: aggregated.finishedAt,
    durationMs: aggregated.durationMs,
    requests: {
      sent: aggregated.operations.sent,
      completed: aggregated.operations.completed,
      averagePerSecond: aggregated.operations.averagePerSecond,
      bytesWritten: aggregated.operations.bytesSent,
      bytesRead: aggregated.operations.bytesReceived
    },
    latencyMs: aggregated.latencyMs,
    latencySnapshot: aggregated.latencySnapshot,
    statusCodes,
    non2xx,
    errors: {
      connection: aggregated.errors.connection,
      timeout: aggregated.errors.timeout,
      protocol: aggregated.errors.protocol,
      abortedRequests: aggregated.errors.aborted,
      total: aggregated.errors.total
    },
    transport: {
      socketWriteCalls: aggregated.transport.sendCalls,
      requestsPerSocketWrite:
        aggregated.transport.sendCalls > 0 ? aggregated.operations.sent / aggregated.transport.sendCalls : null,
      backpressureEvents: aggregated.transport.backpressureEvents,
      drainWaitMs: aggregated.transport.backpressureWaitMs,
      inFlightAtStop: aggregated.transport.inFlightAtStop,
      rateDropped: aggregated.transport.rateDropped,
      meanScheduleLagMs: aggregated.transport.meanScheduleLagMs,
      maxScheduleLagMs: aggregated.transport.maxScheduleLagMs
    },
    loadGenerator: {
      ...aggregated.loadGenerator,
      cpuPerMillionRequestsMs:
        aggregated.operations.completed > 0
          ? (aggregated.loadGenerator.cpuMs / aggregated.operations.completed) * 1_000_000
          : null
    }
  }
}
