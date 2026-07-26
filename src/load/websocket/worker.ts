import { parentPort, workerData } from 'node:worker_threads'
import { WebSocketLoadWorker } from './websocket-load-worker.js'
import type { WebSocketWorkerData } from './worker-protocol.js'

if (!parentPort) {
  throw new Error('WebSocket load worker must run in a worker thread')
}

const worker = new WebSocketLoadWorker(parentPort, workerData as WebSocketWorkerData)

try {
  worker.start()
} catch (error) {
  worker.fail(error)
}
