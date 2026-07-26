import assert from 'node:assert/strict'
import test from 'node:test'
import { BoundedLatencyRecorder } from '../../../../dist/measurement/bounded-latency-recorder.js'
import { aggregateLoadPhase } from '../../../../dist/load/shared/aggregate-load-phase.js'
import type { LoadPhaseResult } from '../../../../dist/load/shared/load-coordinator-context.js'
import type { LoadWorkerResult } from '../../../../dist/load/shared/load-worker-protocol.js'

test('aggregateLoadPhase combines common worker metrics in one transport-neutral result', () => {
  const phase: LoadPhaseResult<LoadWorkerResult> = {
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    finishedAt: new Date('2026-01-01T00:00:01.000Z'),
    durationMs: 1_000,
    workers: [
      worker({
        sent: 6,
        completed: 5,
        bytesSent: 60,
        bytesReceived: 50,
        errors: { connection: 1, timeout: 0, protocol: 0, aborted: 1 },
        backpressureEvents: 2,
        backpressureWaitMs: 3,
        bufferedAmountPeakBytes: 100,
        inFlightAtStop: 1,
        rateDropped: 2,
        scheduleLagTotalMs: 12,
        maxScheduleLagMs: 7,
        scheduledOperations: 3,
        eluPct: 40,
        heapUsedPeakBytes: 100,
        externalPeakBytes: 20,
        arrayBuffersPeakBytes: 10,
        latencySnapshot: latencySnapshot(1)
      }),
      worker({
        sent: 4,
        completed: 3,
        bytesSent: 40,
        bytesReceived: 30,
        errors: { connection: 0, timeout: 1, protocol: 1, aborted: 0 },
        sendCalls: 2,
        bufferedAmountPeakBytes: 200,
        scheduleLagTotalMs: 8,
        maxScheduleLagMs: 5,
        scheduledOperations: 1,
        eluPct: 60,
        heapUsedPeakBytes: 200,
        externalPeakBytes: 30,
        arrayBuffersPeakBytes: 20,
        latencySnapshot: latencySnapshot(2)
      })
    ],
    cpuMs: 500,
    parentEluPct: 10,
    processMemory: processMemory()
  }
  const result = aggregateLoadPhase(phase)

  assert.deepEqual(result.operations, {
    sent: 10,
    completed: 8,
    averagePerSecond: 8,
    bytesSent: 100,
    bytesReceived: 80
  })
  assert.deepEqual(result.errors, {
    connection: 1,
    timeout: 1,
    protocol: 1,
    aborted: 1,
    total: 4
  })
  assert.equal(result.latencySnapshot.count, 2)
  assert.equal(result.transport.sendCalls, 2)
  assert.equal(result.transport.bufferedAmountPeakBytes, 200)
  assert.equal(result.transport.meanScheduleLagMs, 5)
  assert.equal(result.transport.maxScheduleLagMs, 7)
  assert.equal(result.loadGenerator.cpuCorePct, 50)
  assert.equal(result.loadGenerator.meanWorkerEluPct, 50)
  assert.equal(result.loadGenerator.maxWorkerEluPct, 60)
  assert.equal(result.loadGenerator.workerHeapUsedPeakBytes, 300)
})

function worker(overrides: Partial<LoadWorkerResult>): LoadWorkerResult {
  return {
    durationMs: 1_000,
    sent: 0,
    completed: 0,
    bytesSent: 0,
    bytesReceived: 0,
    errors: { connection: 0, timeout: 0, protocol: 0, aborted: 0 },
    latencySnapshot: latencySnapshot(),
    sendCalls: 0,
    backpressureEvents: 0,
    backpressureWaitMs: 0,
    bufferedAmountPeakBytes: 0,
    inFlightAtStop: 0,
    rateDropped: 0,
    scheduleLagTotalMs: 0,
    maxScheduleLagMs: 0,
    scheduledOperations: 0,
    eluPct: 0,
    heapUsedPeakBytes: 0,
    externalPeakBytes: 0,
    arrayBuffersPeakBytes: 0,
    ...overrides
  }
}

function latencySnapshot(value?: number) {
  const recorder = new BoundedLatencyRecorder()

  if (value !== undefined) {
    recorder.record(value)
  }

  return recorder.snapshot()
}

function processMemory(): LoadPhaseResult<LoadWorkerResult>['processMemory'] {
  const metric = {
    startBytes: 0,
    endBytes: 0,
    peakBytes: 0,
    deltaBytes: 0
  }

  return {
    rss: { ...metric },
    heapTotal: { ...metric },
    heapUsed: { ...metric },
    external: { ...metric },
    arrayBuffers: { ...metric }
  }
}
