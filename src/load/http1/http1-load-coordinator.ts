import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { ProcessMemorySampler } from '../../measurement/process-memory.js'
import type { Http1LoadPhaseResult, NormalizedHttp1LoadOptions } from './http1-load-context.js'
import type { Http1WorkerCommand, Http1WorkerData, Http1WorkerMessage } from './worker-protocol.js'

export class Http1LoadCoordinator {
  readonly #options: NormalizedHttp1LoadOptions
  readonly #workers: Worker[] = []
  readonly #memory = new ProcessMemorySampler()

  #memoryStarted = false

  constructor(options: NormalizedHttp1LoadOptions) {
    this.#options = options
  }

  async run(): Promise<Http1LoadPhaseResult> {
    throwIfAborted(this.#options.signal)

    try {
      this.#startWorkers()
      await this.#waitForWorkersReady()
      await this.#runWarmup()

      return await this.#runMeasurement()
    } finally {
      if (this.#memoryStarted) {
        this.#memory.stop()
        this.#memoryStarted = false
      }

      await Promise.allSettled(this.#workers.map((worker) => worker.terminate()))
    }
  }

  #startWorkers(): void {
    const { parameters } = this.#options
    const baseConnections = Math.floor(parameters.connections / parameters.workers)
    const extraConnections = parameters.connections % parameters.workers

    for (let index = 0; index < parameters.workers; index++) {
      const workerConnections = baseConnections + (index < extraConnections ? 1 : 0)
      const data: Http1WorkerData = {
        request: this.#options.request,
        protocol: this.#options.protocol,
        hostname: this.#options.hostname,
        port: this.#options.port,
        method: parameters.method,
        connections: workerConnections,
        pipelining: parameters.pipelining,
        rateSequenceOffset: index,
        rateSequenceStride: parameters.workers,
        correctCoordinatedOmission: parameters.correctCoordinatedOmission,
        timeoutMs: parameters.timeoutMs,
        memorySampleMs: this.#options.memorySampleMs,
        maxHeaderBytes: this.#options.maxHeaderBytes,
        ...(parameters.rate === null ? {} : { ratePerSecond: parameters.rate }),
        ...(this.#options.socketPath === undefined ? {} : { socketPath: this.#options.socketPath }),
        ...(this.#options.tls === undefined ? {} : { tls: this.#options.tls })
      }

      this.#workers.push(new Worker(new URL('./worker.js', import.meta.url), { workerData: data }))
    }
  }

  async #waitForWorkersReady(): Promise<void> {
    await Promise.all(
      this.#workers.map((worker) =>
        this.#waitForWorkerMessage(worker, 'ready', this.#options.startupTimeoutMs, 'HTTP/1 worker startup')
      )
    )
  }

  async #runWarmup(): Promise<void> {
    const warmupMs = this.#options.parameters.warmupMs

    if (warmupMs <= 0) {
      return
    }

    const results = this.#workers.map((worker) =>
      this.#waitForWorkerMessage(
        worker,
        'warmup-complete',
        warmupMs + this.#options.parameters.timeoutMs + 5_000,
        'HTTP/1 warmup'
      )
    )

    this.#startWorkerPhase('warmup', warmupMs)
    await Promise.all(results)
  }

  async #runMeasurement(): Promise<Http1LoadPhaseResult> {
    const { durationMs, timeoutMs } = this.#options.parameters
    const results = this.#workers.map((worker) =>
      this.#waitForWorkerMessage(worker, 'result', durationMs + timeoutMs + 5_000, 'HTTP/1 measurement')
    )
    const startedAt = new Date()
    const eluBefore = performance.eventLoopUtilization()
    const cpuBefore = process.cpuUsage()

    this.#memory.start({ sampleMs: this.#options.memorySampleMs })
    this.#memoryStarted = true
    this.#startWorkerPhase('measurement', durationMs)

    const messages = await Promise.all(results)
    const finishedAt = new Date()
    const elu = performance.eventLoopUtilization(eluBefore)
    const cpu = process.cpuUsage(cpuBefore)
    const processMemory = this.#memory.stop()

    this.#memoryStarted = false

    if (!processMemory) {
      throw new Error('HTTP/1 load process memory sampler did not produce a result')
    }

    const workerResults = messages.map((message) => {
      if (message.type !== 'result') {
        throw new Error('HTTP/1 worker returned an unexpected message')
      }

      return message.result
    })

    return {
      startedAt,
      finishedAt,
      durationMs: Math.max(...workerResults.map((result) => result.durationMs)),
      workers: workerResults,
      cpuMs: (cpu.user + cpu.system) / 1000,
      parentEluPct: elu.utilization * 100,
      processMemory
    }
  }

  #startWorkerPhase(phase: 'warmup' | 'measurement', durationMs: number): void {
    for (const worker of this.#workers) {
      const command: Http1WorkerCommand = {
        type: 'start',
        phase,
        durationMs
      }

      worker.postMessage(command)
    }
  }

  #waitForWorkerMessage<Type extends Http1WorkerMessage['type']>(
    worker: Worker,
    expectedType: Type,
    timeoutMs: number,
    phase: string
  ): Promise<Extract<Http1WorkerMessage, { type: Type }>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`${phase} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      const onMessage = (message: Http1WorkerMessage): void => {
        if (message.type === 'fatal') {
          cleanup()
          reject(new Error(`HTTP/1 worker failed: ${message.error}`))

          return
        }

        if (message.type === expectedType) {
          cleanup()
          resolve(message as Extract<Http1WorkerMessage, { type: Type }>)
        }
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onExit = (code: number): void => {
        cleanup()
        reject(new Error(`HTTP/1 worker exited before ${expectedType} with code ${code}`))
      }
      const onAbort = (): void => {
        cleanup()
        reject(abortError())
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        this.#options.signal?.removeEventListener('abort', onAbort)
      }

      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      this.#options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError()
  }
}

function abortError(): Error {
  const error = new Error('HTTP/1 load was aborted')

  error.name = 'AbortError'

  return error
}
