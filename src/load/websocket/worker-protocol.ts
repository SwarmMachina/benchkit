import type {
  LoadWorkerCommand,
  LoadWorkerData,
  LoadWorkerErrorMetrics,
  LoadWorkerMessage,
  LoadWorkerResult
} from '../shared/load-worker-protocol.js'

export interface WebSocketWorkerData extends LoadWorkerData {
  url: string
  message: string | ArrayBuffer
  protocols: string[]
  maxInFlight: number
  maxBufferedBytes: number
}

export type WebSocketWorkerErrorMetrics = LoadWorkerErrorMetrics

export type WebSocketWorkerResult = LoadWorkerResult

export type WebSocketWorkerMessage = LoadWorkerMessage<WebSocketWorkerResult>

export type WebSocketWorkerCommand = LoadWorkerCommand
