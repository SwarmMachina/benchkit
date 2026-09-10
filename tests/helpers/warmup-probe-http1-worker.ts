import type { MessagePort } from 'node:worker_threads'
import { Http1LoadWorker } from '../../dist/load/http1/http1-load-worker.js'
import type { Http1WorkerData } from '../../dist/load/http1/worker-protocol.js'

export class WarmupProbeHttp1Worker extends Http1LoadWorker {
  #received = 0
  #recorded = 0
  readonly #countsBeforeReset: number[] = []

  constructor(port: MessagePort, data: Http1WorkerData) {
    super(port, data)

    const start = this.measurement.start.bind(this.measurement)
    const recordResponse = this.measurement.recordResponse.bind(this.measurement)

    this.measurement.start = () => {
      this.#countsBeforeReset.push(this.#recorded)
      this.#recorded = 0
      start()
    }
    this.measurement.recordResponse = (statusCode, latencyMs) => {
      this.#recorded++
      recordResponse(statusCode, latencyMs)
    }
  }

  override onResponse(statusCode: number, sentAt: number): boolean {
    this.#received++

    return super.onResponse(statusCode, sentAt)
  }

  get received(): number {
    return this.#received
  }

  get recorded(): number {
    return this.#recorded
  }

  get countsBeforeReset(): readonly number[] {
    return this.#countsBeforeReset.slice()
  }
}
