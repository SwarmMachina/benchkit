import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import type { WebSocketWorkerMessage } from '../../../../dist/load/websocket/worker-protocol.js'
import { WebSocketEchoServer } from '../../../helpers/websocket-echo-server.ts'
import { WarmupProbeWebSocketWorker } from '../../../helpers/warmup-probe-websocket-worker.ts'

test(
  'WebSocket warmup exercises measurement code and resets its output before measurement',
  { timeout: 5000 },
  async (context) => {
    const server = new WebSocketEchoServer()
    const port = await server.start()
    const channel = new MessageChannel()
    const worker = new WarmupProbeWebSocketWorker(channel.port1, {
      url: `ws://127.0.0.1:${port}/warmup`,
      message: 'warmup',
      protocols: [],
      connections: 1,
      maxInFlight: 1,
      maxBufferedBytes: 1024 * 1024,
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
      await server.close()
    })

    const ready = nextMessage(channel.port2, 'ready')

    worker.start()
    await ready

    const warmed = nextMessage(channel.port2, 'warmup-complete')

    channel.port2.postMessage({ type: 'start', phase: 'warmup', durationMs: 100 })
    await warmed
    const warmupRecords = worker.recorded

    assert.ok(worker.received > 0, 'warmup must actually exchange messages')
    assert.ok(warmupRecords > 0, `warmup received ${worker.received} messages but did not record latency/counters`)
    assert.deepEqual(worker.countsBeforeReset, [0])

    const measured = nextMessage(channel.port2, 'result')

    channel.port2.postMessage({ type: 'start', phase: 'measurement', durationMs: 75 })
    const message = await measured

    assert.equal(message.type, 'result')
    assert.deepEqual(worker.countsBeforeReset, [0, warmupRecords])
    assert.ok(message.result.completed > 0)
    assert.equal(message.result.completed, worker.recorded)
    assert.equal(message.result.latencySnapshot.count, worker.recorded)
    assert.equal(server.connectionsOpened, 1)
  }
)

function nextMessage(port: MessagePort, type: WebSocketWorkerMessage['type']): Promise<WebSocketWorkerMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: WebSocketWorkerMessage) => {
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
