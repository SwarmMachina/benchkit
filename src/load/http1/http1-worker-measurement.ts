import { performance } from 'node:perf_hooks'
import { BoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import type { Http1WorkerErrorMetrics, Http1WorkerResult } from './worker-protocol.js'

export class Http1WorkerMeasurement {
  readonly #latency = new BoundedLatencyRecorder()
  readonly #statusCodeCounts = new Float64Array(600)
  readonly #errors: Http1WorkerErrorMetrics = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    abortedRequests: 0
  }

  #sent = 0
  #completed = 0
  #bytesWritten = 0
  #bytesRead = 0
  #non2xx = 0
  #socketWriteCalls = 0
  #backpressureEvents = 0
  #drainWaitMs = 0
  #rateDropped = 0
  #scheduleLagTotalMs = 0
  #maxScheduleLagMs = 0
  #scheduledRequests = 0
  #eluBefore: ReturnType<typeof performance.eventLoopUtilization> | null = null
  #heapUsedPeakBytes = 0
  #externalPeakBytes = 0
  #arrayBuffersPeakBytes = 0

  start(): void {
    this.#reset()
    this.#eluBefore = performance.eventLoopUtilization()
    this.sampleMemory()
  }

  sampleMemory(): void {
    const memory = process.memoryUsage()

    this.#heapUsedPeakBytes = Math.max(this.#heapUsedPeakBytes, memory.heapUsed)
    this.#externalPeakBytes = Math.max(this.#externalPeakBytes, memory.external)
    this.#arrayBuffersPeakBytes = Math.max(this.#arrayBuffersPeakBytes, memory.arrayBuffers)
  }

  recordResponse(statusCode: number, latencyMs: number): void {
    this.#completed++
    this.#statusCodeCounts[statusCode] = (this.#statusCodeCounts[statusCode] ?? 0) + 1

    if (statusCode < 200 || statusCode >= 300) {
      this.#non2xx++
    }

    this.#latency.record(latencyMs)
  }

  recordConnectionError(): void {
    this.#errors.connection++
  }

  recordTimeout(): void {
    this.#errors.timeout++
  }

  recordProtocolError(): void {
    this.#errors.protocol++
  }

  recordAbortedRequests(count: number): void {
    this.#errors.abortedRequests += count
  }

  recordBytesRead(bytes: number): void {
    this.#bytesRead += bytes
  }

  recordRequestsSent(count: number, bytes: number): void {
    this.#sent += count
    this.#bytesWritten += bytes
  }

  recordSocketWrite(): void {
    this.#socketWriteCalls++
  }

  recordBackpressure(): void {
    this.#backpressureEvents++
  }

  recordDrainWait(durationMs: number): void {
    this.#drainWaitMs += durationMs
  }

  recordRateDropped(count: number): void {
    this.#rateDropped += count
  }

  recordScheduleLag(lagMs: number): void {
    this.#scheduleLagTotalMs += lagMs
    this.#maxScheduleLagMs = Math.max(this.#maxScheduleLagMs, lagMs)
    this.#scheduledRequests++
  }

  finish(startedAt: number, inFlightAtStop: number): Http1WorkerResult {
    this.sampleMemory()

    const durationMs = performance.now() - startedAt
    const elu = this.#eluBefore ? performance.eventLoopUtilization(this.#eluBefore) : { utilization: 0 }

    return {
      durationMs,
      sent: this.#sent,
      completed: this.#completed,
      bytesWritten: this.#bytesWritten,
      bytesRead: this.#bytesRead,
      statusCodes: this.#statusCodesResult(),
      non2xx: this.#non2xx,
      errors: { ...this.#errors },
      latencySnapshot: this.#latency.snapshot(),
      socketWriteCalls: this.#socketWriteCalls,
      backpressureEvents: this.#backpressureEvents,
      drainWaitMs: this.#drainWaitMs,
      inFlightAtStop,
      rateDropped: this.#rateDropped,
      scheduleLagTotalMs: this.#scheduleLagTotalMs,
      maxScheduleLagMs: this.#maxScheduleLagMs,
      scheduledRequests: this.#scheduledRequests,
      eluPct: elu.utilization * 100,
      heapUsedPeakBytes: this.#heapUsedPeakBytes,
      externalPeakBytes: this.#externalPeakBytes,
      arrayBuffersPeakBytes: this.#arrayBuffersPeakBytes
    }
  }

  #reset(): void {
    this.#latency.reset()
    this.#statusCodeCounts.fill(0)
    this.#errors.connection = 0
    this.#errors.timeout = 0
    this.#errors.protocol = 0
    this.#errors.abortedRequests = 0
    this.#sent = 0
    this.#completed = 0
    this.#bytesWritten = 0
    this.#bytesRead = 0
    this.#non2xx = 0
    this.#socketWriteCalls = 0
    this.#backpressureEvents = 0
    this.#drainWaitMs = 0
    this.#rateDropped = 0
    this.#scheduleLagTotalMs = 0
    this.#maxScheduleLagMs = 0
    this.#scheduledRequests = 0
    this.#heapUsedPeakBytes = 0
    this.#externalPeakBytes = 0
    this.#arrayBuffersPeakBytes = 0
  }

  #statusCodesResult(): Record<string, number> {
    const result: Record<string, number> = {}

    for (let statusCode = 100; statusCode < this.#statusCodeCounts.length; statusCode++) {
      const count = this.#statusCodeCounts[statusCode] ?? 0

      if (count > 0) {
        result[String(statusCode)] = count
      }
    }

    return result
  }
}
