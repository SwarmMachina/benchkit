import type { MessagePort } from 'node:worker_threads'
import { WebSocketLoadWorker } from '../../dist/load/websocket/websocket-load-worker.js'
import type { WebSocketWorkerData } from '../../dist/load/websocket/worker-protocol.js'

export class WarmupProbeWebSocketWorker extends WebSocketLoadWorker {
  #received = 0
  #recorded = 0
  readonly #countsBeforeReset: number[] = []

  constructor(port: MessagePort, data: WebSocketWorkerData) {
    super(port, data)

    const start = this.measurement.start.bind(this.measurement)
    const recordCompleted = this.measurement.recordCompleted.bind(this.measurement)

    this.measurement.start = () => {
      this.#countsBeforeReset.push(this.#recorded)
      this.#recorded = 0
      start()
    }
    this.measurement.recordCompleted = (latencyMs, bytesReceived) => {
      this.#recorded++
      recordCompleted(latencyMs, bytesReceived)
    }
  }

  override onMessage(payloadBytes: number, sentAt: number): void {
    this.#received++
    super.onMessage(payloadBytes, sentAt)
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
