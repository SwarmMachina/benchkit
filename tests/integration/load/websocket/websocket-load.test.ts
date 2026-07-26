import assert from 'node:assert/strict'
import test from 'node:test'
import { runWebSocketLoad } from '@swarmmachina/benchkit/load/websocket'
import { WebSocketEchoServer } from '../../../helpers/websocket-echo-server.ts'

test('runWebSocketLoad drives native persistent clients and reports generator health', async (context) => {
  const server = new WebSocketEchoServer()
  const port = await server.start()

  context.after(() => server.close())

  const result = await runWebSocketLoad({
    name: 'native echo',
    url: `ws://127.0.0.1:${port}/echo`,
    message: Uint8Array.from([1, 2, 3, 4]),
    connections: 4,
    maxInFlight: 4,
    workers: 2,
    warmupMs: 50,
    durationMs: 150,
    memorySampleMs: 10
  })

  assert.equal(result.parameters.name, 'native echo')
  assert.equal(result.parameters.messageType, 'binary')
  assert.equal(result.parameters.messageBytes, 4)
  assert.equal(result.parameters.connections, 4)
  assert.equal(result.parameters.maxInFlight, 4)
  assert.equal(result.parameters.mode, 'closed-loop')
  assert.equal(server.connectionsOpened, 4)
  assert.ok(result.messages.received > 0)
  assert.ok(result.messages.sent >= result.messages.received)
  assert.equal(result.messages.payloadBytesSent, result.messages.sent * 4)
  assert.equal(result.messages.payloadBytesReceived, result.messages.received * 4)
  assert.ok(result.messages.averagePerSecond > 0)
  assert.equal(result.errors.total, 0)
  assert.equal(result.latencySnapshot.count, result.messages.received)
  assert.ok(result.latencyMs.p95Ms !== null)
  assert.ok(result.latencyMs.p99Ms !== null)
  assert.ok(Number.isFinite(result.loadGenerator.parentEluPct))
  assert.ok(Number.isFinite(result.loadGenerator.maxWorkerEluPct))
  assert.ok(result.loadGenerator.cpuMs > 0)
  assert.ok(result.loadGenerator.processMemory.rss.peakBytes > 0)
  assert.ok(result.loadGenerator.workerHeapUsedPeakBytes > 0)
  assert.equal(result.transport.sendCalls, result.messages.sent)
  assert.ok(result.transport.inFlightAtStop <= 16)
})

test('runWebSocketLoad applies an aggregate fixed rate and reports scheduler health', async (context) => {
  const server = new WebSocketEchoServer()
  const port = await server.start()

  context.after(() => server.close())

  const result = await runWebSocketLoad({
    url: `ws://127.0.0.1:${port}/rate`,
    connections: 4,
    maxInFlight: 2,
    workers: 2,
    rate: 100,
    warmupMs: 50,
    durationMs: 500
  })

  assert.equal(result.parameters.mode, 'fixed-rate')
  assert.equal(result.parameters.rate, 100)
  assert.equal(result.parameters.correctCoordinatedOmission, true)
  assert.ok(result.messages.sent >= 40)
  assert.ok(result.messages.sent <= 55)
  assert.equal(result.transport.rateDropped, 0)
  assert.ok(result.transport.meanScheduleLagMs !== null)
  assert.ok(result.transport.meanScheduleLagMs >= 0)
  assert.ok(result.transport.maxScheduleLagMs >= result.transport.meanScheduleLagMs)
  assert.equal(result.errors.total, 0)
})

test('runWebSocketLoad drops fixed-rate arrivals instead of growing an unbounded backlog', async (context) => {
  const server = new WebSocketEchoServer({ delayMs: 40 })
  const port = await server.start()

  context.after(() => server.close())

  const result = await runWebSocketLoad({
    url: `ws://127.0.0.1:${port}/slow`,
    connections: 1,
    maxInFlight: 1,
    workers: 1,
    rate: 1_000,
    durationMs: 150
  })

  assert.ok(result.transport.rateDropped > 0)
  assert.ok(result.messages.sent < 10)
  assert.ok(result.transport.inFlightAtStop <= 1)
})

test('runWebSocketLoad aborts a running phase and terminates its workers', async (context) => {
  const server = new WebSocketEchoServer()
  const port = await server.start()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 50)

  context.after(() => {
    clearTimeout(timer)

    return server.close()
  })

  await assert.rejects(
    runWebSocketLoad({
      url: `ws://127.0.0.1:${port}/abort`,
      connections: 1,
      workers: 1,
      durationMs: 5_000,
      signal: controller.signal
    }),
    { name: 'AbortError' }
  )
})
