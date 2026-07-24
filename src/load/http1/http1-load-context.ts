import type { ProcessMemorySummary } from '../../measurement/process-memory.js'
import type { Http1LoadParameters, RunHttp1LoadOptions } from './types.js'
import type { Http1WorkerResult } from './worker-protocol.js'

export interface NormalizedHttp1LoadOptions {
  parameters: Http1LoadParameters
  request: Buffer
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  socketPath?: string
  tls?: RunHttp1LoadOptions['tls']
  startupTimeoutMs: number
  memorySampleMs: number
  maxHeaderBytes: number
  signal?: AbortSignal
}

export interface Http1LoadPhaseResult {
  startedAt: Date
  finishedAt: Date
  durationMs: number
  workers: Http1WorkerResult[]
  cpuMs: number
  parentEluPct: number
  processMemory: ProcessMemorySummary
}
