import os from 'node:os'
import { runWebSocketLoad } from '../dist/load/websocket/index.js'
import { fixed } from '../dist/reporting/format.js'
import { numberEnvironment } from './helpers/environment.js'

const url = process.env.BENCHKIT_WS_URL

if (!url) {
  throw new Error('BENCHKIT_WS_URL must point to an echo/request-response WebSocket endpoint')
}

const connections = numberEnvironment('BENCHKIT_WS_CONNECTIONS', 100)
const maxInFlight = numberEnvironment('BENCHKIT_WS_MAX_IN_FLIGHT', 1)
const durationMs = numberEnvironment('BENCHKIT_WS_DURATION_MS', 2_000)
const warmupMs = numberEnvironment('BENCHKIT_WS_WARMUP_MS', 500)
const workers = Math.min(numberEnvironment('BENCHKIT_WS_WORKERS', 4), connections, os.availableParallelism())
const rate = numberEnvironment('BENCHKIT_WS_RATE')
const message = process.env.BENCHKIT_WS_MESSAGE ?? 'ping'
const result = await runWebSocketLoad({
  name: 'native WebSocket echo',
  url,
  connections,
  maxInFlight,
  workers,
  message,
  ...(rate === undefined ? {} : { rate }),
  durationMs,
  warmupMs,
  memorySampleMs: 25
})

console.log(
  `parameters: mode=${rate === undefined ? 'closed-loop' : 'fixed-rate'} rate=${rate ?? 'n/a'} ` +
    `connections=${connections} durationMs=${durationMs} maxInFlight=${maxInFlight} ` +
    `workers=${workers} warmupMs=${warmupMs} messageBytes=${Buffer.byteLength(message)}`
)
console.table([
  {
    messagesPerSecond: Math.round(result.messages.averagePerSecond),
    p95Ms: fixed(result.latencyMs.p95Ms),
    p99Ms: fixed(result.latencyMs.p99Ms),
    cpuCorePct: fixed(result.loadGenerator.cpuCorePct),
    workerEluPct: fixed(result.loadGenerator.maxWorkerEluPct),
    rssPeakMiB: fixed(result.loadGenerator.processMemory.rss.peakBytes / 1024 / 1024),
    bufferedPeakBytes: result.transport.bufferedAmountPeakBytes,
    backpressureEvents: result.transport.backpressureEvents,
    rateDropped: result.transport.rateDropped,
    errors: result.errors.total
  }
])
