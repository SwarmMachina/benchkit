import { LoadCoordinator } from '../shared/load-coordinator.js'
import type { NormalizedHttp1LoadOptions } from './http1-load-context.js'
import type { Http1LoadParameters } from './types.js'
import type { Http1WorkerData, Http1WorkerResult } from './worker-protocol.js'

export class Http1LoadCoordinator extends LoadCoordinator<
  Http1LoadParameters,
  NormalizedHttp1LoadOptions,
  Http1WorkerData,
  Http1WorkerResult
> {
  protected readonly loadName = 'HTTP/1'
  protected readonly workerUrl = new URL('./worker.js', import.meta.url)

  constructor(options: NormalizedHttp1LoadOptions) {
    super(options)
  }

  protected buildWorkerData(workerIndex: number, connections: number): Http1WorkerData {
    const { parameters } = this.options

    return {
      request: this.options.request,
      protocol: this.options.protocol,
      hostname: this.options.hostname,
      port: this.options.port,
      method: parameters.method,
      connections,
      pipelining: parameters.pipelining,
      rateSequenceOffset: workerIndex,
      rateSequenceStride: parameters.workers,
      correctCoordinatedOmission: parameters.correctCoordinatedOmission,
      timeoutMs: parameters.timeoutMs,
      memorySampleMs: this.options.memorySampleMs,
      maxHeaderBytes: this.options.maxHeaderBytes,
      ...(parameters.rate === null ? {} : { ratePerSecond: parameters.rate }),
      ...(this.options.socketPath === undefined ? {} : { socketPath: this.options.socketPath }),
      ...(this.options.tls === undefined ? {} : { tls: this.options.tls })
    }
  }
}
