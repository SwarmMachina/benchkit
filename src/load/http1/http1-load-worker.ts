import { performance } from 'node:perf_hooks'
import type { MessagePort } from 'node:worker_threads'
import { LoadWorker } from '../shared/load-worker.js'
import { Http1Connection, type Http1ConnectionOwner } from './http1-connection.js'
import { Http1WorkerMeasurement } from './http1-worker-measurement.js'
import type { Http1WorkerData, Http1WorkerResult } from './worker-protocol.js'

const MAX_BATCH_BYTES = 1024 * 1024

export class Http1LoadWorker
  extends LoadWorker<Http1WorkerData, Http1Connection, Http1WorkerResult, Http1WorkerMeasurement>
  implements Http1ConnectionOwner
{
  protected readonly loadName = 'HTTP/1'

  readonly #request: Buffer
  readonly #requestBatch: Buffer | null

  constructor(port: MessagePort, data: Http1WorkerData) {
    super(port, data, new Http1WorkerMeasurement())
    this.#request = Buffer.from(data.request)
    this.#requestBatch =
      this.#request.length * data.pipelining <= MAX_BATCH_BYTES
        ? Buffer.concat(Array.from({ length: data.pipelining }, () => this.#request))
        : null
  }

  onConnectionClosed(abortedRequests: number): boolean {
    this.recordAborted(abortedRequests)

    return this.shouldReconnect
  }

  onResponse(statusCode: number, sentAt: number): boolean {
    const now = performance.now()

    if (this.measurementActive) {
      this.measurement.recordResponse(statusCode, now - sentAt)
    }

    this.onConnectionIdle()

    return this.canContinueClosedLoop(now)
  }

  onBytesRead(bytes: number): void {
    if (this.measurementActive) {
      this.measurement.recordBytesReceived(bytes)
    }
  }

  onRequestsSent(count: number, bytes: number): void {
    if (this.measurementActive) {
      this.measurement.recordSent(count, bytes)
    }
  }

  onSocketWrite(): void {
    if (this.measurementActive) {
      this.measurement.recordSendCall()
    }
  }

  protected createConnection(): Http1Connection {
    return new Http1Connection(this, this.data, this.#request, this.#requestBatch)
  }
}
