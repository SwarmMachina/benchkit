import { parentPort, workerData } from 'node:worker_threads'
import { Http1LoadWorker } from './http1-load-worker.js'
import type { Http1WorkerData } from './worker-protocol.js'

if (!parentPort) {
  throw new Error('HTTP/1 load worker must run in a worker thread')
}

const worker = new Http1LoadWorker(parentPort, workerData as Http1WorkerData)

try {
  worker.start()
} catch (error) {
  worker.fail(error)
}
