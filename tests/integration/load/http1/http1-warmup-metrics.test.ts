import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { Http1WorkerMessage } from '../../../../dist/load/http1/worker-protocol.js'
import { WarmupProbeHttp1Worker } from '../../../helpers/warmup-probe-http1-worker.ts'

test(
  'HTTP warmup exercises response recording and resets status codes before measurement',
  { timeout: 5000 },
  async (context) => {
    let connectionsOpened = 0

    const server = http.createServer((request, response) => {
      request.resume()
      response.writeHead(200, { 'content-length': '2' })
      response.end('ok')
    })

    server.on('connection', () => {
      connectionsOpened++
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()

    assert.ok(address && typeof address !== 'string')
    const channel = new MessageChannel()
    const worker = new WarmupProbeHttp1Worker(channel.port1, {
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: address.port,
      method: 'GET',
      request: Buffer.from('GET /warmup HTTP/1.1\r\nHost: localhost\r\n\r\n'),
      pipelining: 4,
      maxHeaderBytes: 16384,
      connections: 1,
      rateSequenceOffset: 0,
      rateSequenceStride: 1,
      correctCoordinatedOmission: false,
      timeoutMs: 1000,
      memorySampleMs: 10
    })

    context.after(async () => {
      worker.fail(new Error('test cleanup'))
      channel.port1.close()
      channel.port2.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    })
    const ready = nextMessage(channel.port2, 'ready')

    worker.start()
    await ready
    const warmed = nextMessage(channel.port2, 'warmup-complete')

    channel.port2.postMessage({ type: 'start', phase: 'warmup', durationMs: 100 })
    await warmed
    const warmupRecords = worker.recorded

    assert.ok(worker.received > 0, 'warmup must actually receive responses')
    assert.ok(warmupRecords > 0, `warmup received ${worker.received} responses but did not record latency/status codes`)
    assert.deepEqual(worker.countsBeforeReset, [0])
    const measured = nextMessage(channel.port2, 'result')

    channel.port2.postMessage({ type: 'start', phase: 'measurement', durationMs: 75 })
    const message = await measured

    assert.equal(message.type, 'result')
    assert.deepEqual(worker.countsBeforeReset, [0, warmupRecords])
    assert.ok(message.result.completed > 0)
    assert.equal(message.result.completed, worker.recorded)
    assert.equal(message.result.latencySnapshot.count, worker.recorded)
    assert.deepEqual(message.result.statusCodes, { 200: worker.recorded })
    assert.equal(connectionsOpened, 1)
  }
)

function nextMessage(port: MessagePort, type: Http1WorkerMessage['type']): Promise<Http1WorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: Http1WorkerMessage) => {
      if (message.type === 'fatal') {
        port.off('message', onMessage)
        reject(new Error(message.error))
      } else if (message.type === type) {
        port.off('message', onMessage)
        resolve(message)
      }
    }

    port.on('message', onMessage)
  })
}
