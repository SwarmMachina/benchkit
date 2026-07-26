import type { LoadCoordinatorOptions, LoadPhaseResult } from '../shared/load-coordinator-context.js'
import type { WebSocketLoadParameters } from './types.js'
import type { WebSocketWorkerResult } from './worker-protocol.js'

export interface NormalizedWebSocketLoadOptions extends LoadCoordinatorOptions<WebSocketLoadParameters> {
  message: string | ArrayBuffer
}

export type WebSocketLoadPhaseResult = LoadPhaseResult<WebSocketWorkerResult>
