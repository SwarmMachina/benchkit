import { LoadWorkerMeasurement } from '../shared/load-worker-measurement.js'
import type { LoadWorkerResult } from '../shared/load-worker-protocol.js'
import type { WebSocketWorkerResult } from './worker-protocol.js'

export class WebSocketWorkerMeasurement extends LoadWorkerMeasurement<WebSocketWorkerResult> {
  constructor() {
    super()
  }

  recordMessage(latencyMs: number, payloadBytes: number): void {
    this.recordCompleted(latencyMs, payloadBytes)
  }

  recordMessageSent(payloadBytes: number): void {
    this.recordSent(1, payloadBytes, 1)
  }

  protected buildResult(common: LoadWorkerResult): WebSocketWorkerResult {
    return common
  }
}
