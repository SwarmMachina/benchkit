import type {
  LoadWorkerCommand,
  LoadWorkerData,
  LoadWorkerErrorMetrics,
  LoadWorkerMessage,
  LoadWorkerResult
} from '../shared/load-worker-protocol.js'
import type { Http1TlsOptions } from './types.js'

export interface Http1WorkerData extends LoadWorkerData {
  request: Uint8Array
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  socketPath?: string
  tls?: Http1TlsOptions
  method: string
  pipelining: number
  maxHeaderBytes: number
}

export type Http1WorkerErrorMetrics = LoadWorkerErrorMetrics

export interface Http1WorkerResult extends LoadWorkerResult {
  statusCodes: Record<string, number>
  non2xx: number
}

export type Http1WorkerMessage = LoadWorkerMessage<Http1WorkerResult>

export type Http1WorkerCommand = LoadWorkerCommand
