import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { runHttp1Load } from '@swarmmachina/benchkit/load/http1'

test('runHttp1Load drives pipelined content-length responses and reports generator health', async (context) => {
  let connectionsOpened = 0

  const server = http.createServer((request, response) => {
    request.resume()
    response.statusCode = 200
    response.setHeader('content-length', '2')
    response.end('ok')
  })

  server.on('connection', () => {
    connectionsOpened++
  })
  const port = await listen(server)

  context.after(() => close(server))

  const result = await runHttp1Load({
    name: 'content-length',
    url: `http://127.0.0.1:${port}/fixed`,
    connections: 4,
    pipelining: 4,
    workers: 2,
    warmupMs: 50,
    durationMs: 150,
    memorySampleMs: 10
  })

  assert.equal(result.parameters.name, 'content-length')
  assert.equal(result.parameters.connections, 4)
  assert.equal(result.parameters.pipelining, 4)
  assert.equal(result.parameters.mode, 'closed-loop')
  assert.equal(connectionsOpened, 4)
  assert.ok(result.requests.completed > 0)
  assert.ok(result.requests.sent >= result.requests.completed)
  assert.ok(result.requests.averagePerSecond > 0)
  assert.ok(result.requests.bytesWritten > 0)
  assert.equal(result.statusCodes['200'], result.requests.completed)
  assert.equal(result.non2xx, 0)
  assert.deepEqual(result.errors, {
    connection: 0,
    timeout: 0,
    protocol: 0,
    abortedRequests: 0,
    total: 0
  })
  assert.equal(result.latencySnapshot.count, result.requests.completed)
  assert.ok(result.latencyMs.p95Ms !== null)
  assert.ok(Number.isFinite(result.loadGenerator.parentEluPct))
  assert.ok(Number.isFinite(result.loadGenerator.maxWorkerEluPct))
  assert.ok(result.loadGenerator.cpuMs > 0)
  assert.ok(result.loadGenerator.cpuCorePct > 0)
  assert.ok(result.loadGenerator.cpuPerMillionRequestsMs !== null)
  assert.ok(result.loadGenerator.processMemory.rss.peakBytes > 0)
  assert.ok(result.loadGenerator.workerHeapUsedPeakBytes > 0)
  assert.ok(result.transport.socketWriteCalls > 0)
  assert.ok(result.transport.requestsPerSocketWrite !== null)
  assert.ok(result.transport.inFlightAtStop >= 0)
})

test('runHttp1Load applies fixed aggregate rate and reports scheduler health', async (context) => {
  const server = http.createServer((request, response) => {
    request.resume()
    response.setHeader('content-length', '2')
    response.end('ok')
  })
  const port = await listen(server)

  context.after(() => close(server))

  const result = await runHttp1Load({
    url: `http://127.0.0.1:${port}/rate`,
    connections: 4,
    pipelining: 2,
    workers: 2,
    rate: 400,
    warmupMs: 50,
    durationMs: 500
  })

  assert.equal(result.parameters.mode, 'fixed-rate')
  assert.equal(result.parameters.rate, 400)
  assert.equal(result.parameters.correctCoordinatedOmission, true)
  assert.ok(result.requests.sent >= 170)
  assert.ok(result.requests.sent <= 210)
  assert.equal(result.transport.rateDropped, 0)
  assert.ok(result.transport.meanScheduleLagMs !== null)
  assert.ok(result.transport.meanScheduleLagMs >= 0)
  assert.ok(result.transport.maxScheduleLagMs >= result.transport.meanScheduleLagMs)
  assert.equal(result.errors.total, 0)
})

test('runHttp1Load observes socket backpressure without exceeding pipeline capacity', async (context) => {
  const server = http.createServer((request, response) => {
    request.resume()
    response.setHeader('content-length', '2')
    response.end('ok')
  })
  const port = await listen(server)

  context.after(() => close(server))

  const result = await runHttp1Load({
    url: `http://127.0.0.1:${port}/backpressure`,
    method: 'POST',
    body: 'x'.repeat(128 * 1024),
    connections: 1,
    pipelining: 8,
    workers: 1,
    durationMs: 150
  })

  assert.ok(result.requests.completed > 0)
  assert.ok(result.transport.backpressureEvents > 0)
  assert.ok(result.transport.drainWaitMs >= 0)
  assert.ok(result.transport.inFlightAtStop <= 8)
  assert.equal(result.errors.protocol, 0)
})

test('runHttp1Load drops fixed-rate arrivals instead of building an unbounded queue', async (context) => {
  const server = http.createServer((request, response) => {
    request.resume()
    setTimeout(() => {
      response.setHeader('content-length', '2')
      response.end('ok')
    }, 40)
  })
  const port = await listen(server)

  context.after(() => close(server))

  const result = await runHttp1Load({
    url: `http://127.0.0.1:${port}/slow`,
    connections: 1,
    pipelining: 1,
    workers: 1,
    rate: 1_000,
    durationMs: 150
  })

  assert.ok(result.transport.rateDropped > 0)
  assert.ok(result.requests.sent < 10)
  assert.ok(result.transport.inFlightAtStop <= 1)
})

test('runHttp1Load parses chunked responses and counts non-2xx status codes', async (context) => {
  const server = http.createServer((request, response) => {
    request.resume()

    if (request.url === '/no-content') {
      response.statusCode = 204
      response.end()

      return
    }

    if (request.url === '/unavailable') {
      response.statusCode = 503
    }

    response.write('first')
    response.addTrailers({ 'x-benchkit-trailer': 'ok' })
    response.end('second')
  })
  const port = await listen(server)

  context.after(() => close(server))

  const chunked = await runHttp1Load({
    url: `http://127.0.0.1:${port}/chunked`,
    connections: 2,
    pipelining: 2,
    workers: 1,
    durationMs: 100
  })
  const unavailable = await runHttp1Load({
    url: `http://127.0.0.1:${port}/unavailable`,
    connections: 1,
    pipelining: 1,
    workers: 1,
    durationMs: 75
  })
  const noContent = await runHttp1Load({
    url: `http://127.0.0.1:${port}/no-content`,
    connections: 1,
    pipelining: 2,
    workers: 1,
    durationMs: 50
  })

  assert.ok(chunked.requests.completed > 0)
  assert.equal(chunked.statusCodes['200'], chunked.requests.completed)
  assert.equal(chunked.errors.protocol, 0)
  assert.ok(unavailable.requests.completed > 0)
  assert.equal(unavailable.statusCodes['503'], unavailable.requests.completed)
  assert.equal(unavailable.non2xx, unavailable.requests.completed)
  assert.ok(noContent.requests.completed > 0)
  assert.equal(noContent.statusCodes['204'], noContent.requests.completed)
  assert.equal(noContent.errors.protocol, 0)
})

test('runHttp1Load aborts a running phase and terminates its workers', async (context) => {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-length', '2')
    response.end('ok')
  })
  const port = await listen(server)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 50)

  context.after(() => {
    clearTimeout(timer)

    return close(server)
  })

  await assert.rejects(
    runHttp1Load({
      url: `http://127.0.0.1:${port}/abort`,
      connections: 1,
      workers: 1,
      durationMs: 5_000,
      signal: controller.signal
    }),
    { name: 'AbortError' }
  )
})

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)

      const address = server.address()

      if (!address || typeof address === 'string') {
        reject(new Error('HTTP test server did not expose a TCP port'))

        return
      }

      resolve(address.port)
    })
  })
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}
