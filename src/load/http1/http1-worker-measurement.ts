import { LoadWorkerMeasurement } from '../shared/load-worker-measurement.js'
import type { LoadWorkerResult } from '../shared/load-worker-protocol.js'
import type { Http1WorkerResult } from './worker-protocol.js'

export class Http1WorkerMeasurement extends LoadWorkerMeasurement<Http1WorkerResult> {
  readonly #statusCodeCounts = new Float64Array(600)

  #non2xx = 0

  constructor() {
    super()
  }

  recordResponse(statusCode: number, latencyMs: number): void {
    this.#statusCodeCounts[statusCode] = (this.#statusCodeCounts[statusCode] ?? 0) + 1

    if (statusCode < 200 || statusCode >= 300) {
      this.#non2xx++
    }

    this.recordCompleted(latencyMs)
  }

  protected buildResult(common: LoadWorkerResult): Http1WorkerResult {
    return {
      ...common,
      statusCodes: this.#statusCodesResult(),
      non2xx: this.#non2xx
    }
  }

  protected resetProtocolMetrics(): void {
    this.#statusCodeCounts.fill(0)
    this.#non2xx = 0
  }

  #statusCodesResult(): Record<string, number> {
    const result: Record<string, number> = {}

    for (let statusCode = 100; statusCode < this.#statusCodeCounts.length; statusCode++) {
      const count = this.#statusCodeCounts[statusCode] ?? 0

      if (count > 0) {
        result[String(statusCode)] = count
      }
    }

    return result
  }
}
