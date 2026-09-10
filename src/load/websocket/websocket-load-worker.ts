import { performance } from 'node:perf_hooks'
import type { MessagePort } from 'node:worker_threads'
import { LoadWorker } from '../shared/load-worker.js'
import { WebSocketConnection, type WebSocketConnectionOwner } from './websocket-connection.js'
import { WebSocketWorkerMeasurement } from './websocket-worker-measurement.js'
import type { WebSocketWorkerData, WebSocketWorkerResult } from './worker-protocol.js'

export class WebSocketLoadWorker
  extends LoadWorker<WebSocketWorkerData, WebSocketConnection, WebSocketWorkerResult, WebSocketWorkerMeasurement>
  implements WebSocketConnectionOwner
{
  protected readonly loadName = 'WebSocket'

  constructor(port: MessagePort, data: WebSocketWorkerData) {
    super(port, data, new WebSocketWorkerMeasurement())
  }

  onConnectionClosed(abortedMessages: number): void {
    this.recordAborted(abortedMessages)
  }

  onMessage(payloadBytes: number, sentAt: number): void {
    if (this.recordingActive) {
      this.measurement.recordMessage(performance.now() - sentAt, payloadBytes)
    }
  }

  onMessageSent(payloadBytes: number): void {
    if (this.recordingActive) {
      this.measurement.recordMessageSent(payloadBytes)
    }
  }

  protected createConnection(): WebSocketConnection {
    return new WebSocketConnection(this, this.data)
  }
}
