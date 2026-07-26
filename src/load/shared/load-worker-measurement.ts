import { performance } from 'node:perf_hooks'
import { BoundedLatencyRecorder } from '../../measurement/bounded-latency-recorder.js'
import { ProcessMemoryPeakTracker } from '../../measurement/process-memory-peak-tracker.js'
import type { LoadWorkerErrorMetrics, LoadWorkerResult } from './load-worker-protocol.js'

export abstract class LoadWorkerMeasurement<Result extends LoadWorkerResult> {
  readonly #latency = new BoundedLatencyRecorder()
  readonly #memory = new ProcessMemoryPeakTracker()
  readonly #errors: LoadWorkerErrorMetrics = {
    connection: 0,
    timeout: 0,
    protocol: 0,
    aborted: 0
  }

  #sent = 0
  #completed = 0
  #bytesSent = 0
  #bytesReceived = 0
  #sendCalls = 0
  #backpressureEvents = 0
  #backpressureWaitMs = 0
  #bufferedAmountPeakBytes = 0
  #rateDropped = 0
  #scheduleLagTotalMs = 0
  #maxScheduleLagMs = 0
  #scheduledOperations = 0
  #eluBefore: ReturnType<typeof performance.eventLoopUtilization> | null = null
  protected constructor() {}

  start(): void {
    this.#reset()
    this.resetProtocolMetrics()
    this.#eluBefore = performance.eventLoopUtilization()
    this.#memory.start()
  }

  sampleMemory(): void {
    this.#memory.sample()
  }

  recordCompleted(latencyMs: number, bytesReceived = 0): void {
    this.#completed++
    this.#bytesReceived += bytesReceived
    this.#latency.record(latencyMs)
  }

  recordSent(count: number, bytesSent: number, sendCalls = 0): void {
    this.#sent += count
    this.#bytesSent += bytesSent
    this.#sendCalls += sendCalls
  }

  recordBytesReceived(bytes: number): void {
    this.#bytesReceived += bytes
  }

  recordSendCall(): void {
    this.#sendCalls++
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

  recordAborted(count: number): void {
    this.#errors.aborted += count
  }

  recordBackpressure(): void {
    this.#backpressureEvents++
  }

  recordBackpressureWait(durationMs: number): void {
    this.#backpressureWaitMs += durationMs
  }

  recordBufferedAmount(bytes: number): void {
    this.#bufferedAmountPeakBytes = Math.max(this.#bufferedAmountPeakBytes, bytes)
  }

  recordRateDropped(count: number): void {
    this.#rateDropped += count
  }

  recordScheduleLag(lagMs: number): void {
    this.#scheduleLagTotalMs += lagMs
    this.#maxScheduleLagMs = Math.max(this.#maxScheduleLagMs, lagMs)
    this.#scheduledOperations++
  }

  finish(startedAt: number, inFlightAtStop: number): Result {
    const durationMs = performance.now() - startedAt
    const elu = this.#eluBefore ? performance.eventLoopUtilization(this.#eluBefore) : { utilization: 0 }
    const memory = this.#memory.stop()

    if (!memory) {
      throw new Error('load worker memory peak tracker did not produce a result')
    }

    const common: LoadWorkerResult = {
      durationMs,
      sent: this.#sent,
      completed: this.#completed,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
      errors: { ...this.#errors },
      latencySnapshot: this.#latency.snapshot(),
      sendCalls: this.#sendCalls,
      backpressureEvents: this.#backpressureEvents,
      backpressureWaitMs: this.#backpressureWaitMs,
      bufferedAmountPeakBytes: this.#bufferedAmountPeakBytes,
      inFlightAtStop,
      rateDropped: this.#rateDropped,
      scheduleLagTotalMs: this.#scheduleLagTotalMs,
      maxScheduleLagMs: this.#maxScheduleLagMs,
      scheduledOperations: this.#scheduledOperations,
      eluPct: elu.utilization * 100,
      heapUsedPeakBytes: memory.peak.heapUsed,
      externalPeakBytes: memory.peak.external,
      arrayBuffersPeakBytes: memory.peak.arrayBuffers
    }

    return this.buildResult(common)
  }

  protected abstract buildResult(common: LoadWorkerResult): Result

  protected resetProtocolMetrics(): void {}

  #reset(): void {
    this.#latency.reset()
    this.#errors.connection = 0
    this.#errors.timeout = 0
    this.#errors.protocol = 0
    this.#errors.aborted = 0
    this.#sent = 0
    this.#completed = 0
    this.#bytesSent = 0
    this.#bytesReceived = 0
    this.#sendCalls = 0
    this.#backpressureEvents = 0
    this.#backpressureWaitMs = 0
    this.#bufferedAmountPeakBytes = 0
    this.#rateDropped = 0
    this.#scheduleLagTotalMs = 0
    this.#maxScheduleLagMs = 0
    this.#scheduledOperations = 0
  }
}
