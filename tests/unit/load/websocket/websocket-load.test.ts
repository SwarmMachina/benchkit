import assert from 'node:assert/strict'
import test from 'node:test'
import { runWebSocketLoad } from '@swarmmachina/benchkit/load/websocket'

test('runWebSocketLoad validates URL, topology, rate, and payload before starting workers', async () => {
  await assert.rejects(runWebSocketLoad({ url: 'http://example.com' }), /must use ws: or wss:/u)
  await assert.rejects(
    runWebSocketLoad({ url: 'ws://127.0.0.1', connections: 1, workers: 2 }),
    /workers must not exceed connections/u
  )
  await assert.rejects(runWebSocketLoad({ url: 'ws://127.0.0.1', rate: 0 }), /rate must be a positive/u)
  await assert.rejects(runWebSocketLoad({ url: 'ws://127.0.0.1', correctCoordinatedOmission: true }), /requires rate/u)
  await assert.rejects(
    runWebSocketLoad({ url: 'ws://127.0.0.1', message: new DataView(new ArrayBuffer(1)) as never }),
    /message must be a string or Uint8Array/u
  )
  await assert.rejects(
    runWebSocketLoad({ url: 'ws://127.0.0.1', protocols: ['echo', 'echo'] }),
    /must not contain duplicates/u
  )
})

test('runWebSocketLoad observes an already aborted signal before creating workers', async () => {
  const controller = new AbortController()

  controller.abort()

  await assert.rejects(runWebSocketLoad({ url: 'ws://127.0.0.1', signal: controller.signal }), {
    name: 'AbortError'
  })
})
