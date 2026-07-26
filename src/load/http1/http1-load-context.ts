import type { LoadCoordinatorOptions, LoadPhaseResult } from '../shared/load-coordinator-context.js'
import type { Http1LoadParameters, RunHttp1LoadOptions } from './types.js'
import type { Http1WorkerResult } from './worker-protocol.js'

export interface NormalizedHttp1LoadOptions extends LoadCoordinatorOptions<Http1LoadParameters> {
  request: Buffer
  protocol: 'http:' | 'https:'
  hostname: string
  port: number
  socketPath?: string
  tls?: RunHttp1LoadOptions['tls']
  maxHeaderBytes: number
}

export type Http1LoadPhaseResult = LoadPhaseResult<Http1WorkerResult>
