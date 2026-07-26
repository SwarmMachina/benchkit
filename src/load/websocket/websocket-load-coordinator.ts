import { LoadCoordinator } from '../shared/load-coordinator.js'
import type { WebSocketLoadParameters } from './types.js'
import type { NormalizedWebSocketLoadOptions } from './websocket-load-context.js'
import type { WebSocketWorkerData, WebSocketWorkerResult } from './worker-protocol.js'

export class WebSocketLoadCoordinator extends LoadCoordinator<
  WebSocketLoadParameters,
  NormalizedWebSocketLoadOptions,
  WebSocketWorkerData,
  WebSocketWorkerResult
> {
  protected readonly loadName = 'WebSocket'
  protected readonly workerUrl = new URL('./worker.js', import.meta.url)

  constructor(options: NormalizedWebSocketLoadOptions) {
    super(options)
  }

  protected buildWorkerData(workerIndex: number, connections: number): WebSocketWorkerData {
    const { parameters } = this.options

    return {
      url: parameters.url,
      message: this.options.message,
      protocols: [...parameters.protocols],
      connections,
      maxInFlight: parameters.maxInFlight,
      rateSequenceOffset: workerIndex,
      rateSequenceStride: parameters.workers,
      correctCoordinatedOmission: parameters.correctCoordinatedOmission,
      timeoutMs: parameters.timeoutMs,
      memorySampleMs: this.options.memorySampleMs,
      maxBufferedBytes: parameters.maxBufferedBytes,
      ...(parameters.rate === null ? {} : { ratePerSecond: parameters.rate })
    }
  }
}
