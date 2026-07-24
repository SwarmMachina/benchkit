import http from 'node:http'
import os from 'node:os'
import { runHttp1Load } from '../dist/load/http1/index.js'

const connections = numberEnvironment('BENCHKIT_HTTP_CONNECTIONS', 100)
const pipelining = numberEnvironment('BENCHKIT_HTTP_PIPELINING', 10)
const durationMs = numberEnvironment('BENCHKIT_HTTP_DURATION_MS', 2_000)
const warmupMs = numberEnvironment('BENCHKIT_HTTP_WARMUP_MS', 500)
const workers = Math.min(numberEnvironment('BENCHKIT_HTTP_WORKERS', 4), connections, os.availableParallelism())
const rate = optionalNumberEnvironment('BENCHKIT_HTTP_RATE')
const server = http.createServer((request, response) => {
  request.resume()
  response.setHeader('content-type', 'application/json')
  response.setHeader('content-length', '11')
  response.end('{"ok":true}')
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('benchmark server did not expose a TCP port')
  }

  const result = await runHttp1Load({
    name: 'node:http fixed response',
    url: `http://127.0.0.1:${address.port}/`,
    connections,
    pipelining,
    workers,
    ...(rate === undefined ? {} : { rate }),
    durationMs,
    warmupMs,
    memorySampleMs: 25
  })

  console.log(
    `parameters: mode=${rate === undefined ? 'closed-loop' : 'fixed-rate'} rate=${rate ?? 'n/a'} ` +
      `connections=${connections} durationMs=${durationMs} pipelining=${pipelining} ` +
      `workers=${workers} warmupMs=${warmupMs}`
  )
  console.table([
    {
      rps: Math.round(result.requests.averagePerSecond),
      p95Ms: fixed(result.latencyMs.p95Ms),
      p99Ms: fixed(result.latencyMs.p99Ms),
      cpuCorePct: fixed(result.loadGenerator.cpuCorePct),
      workerEluPct: fixed(result.loadGenerator.maxWorkerEluPct),
      rssPeakMiB: fixed(result.loadGenerator.processMemory.rss.peakBytes / 1024 / 1024),
      requestsPerWrite: fixed(result.transport.requestsPerSocketWrite),
      backpressureEvents: result.transport.backpressureEvents,
      rateDropped: result.transport.rateDropped,
      errors: result.errors.total
    }
  ])
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

/**
 * @param {string} name
 * @returns {number | undefined}
 */
function optionalNumberEnvironment(name) {
  const raw = process.env[name]

  if (raw === undefined) {
    return undefined
  }

  const value = Number(raw)

  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number`)
  }

  return value
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function numberEnvironment(name, fallback) {
  const raw = process.env[name]

  if (raw === undefined) {
    return fallback
  }

  const value = Number(raw)

  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number`)
  }

  return value
}

/**
 * @param {number | null} value
 * @returns {number | string}
 */
function fixed(value) {
  return value === null ? 'n/a' : Number(value.toFixed(2))
}
