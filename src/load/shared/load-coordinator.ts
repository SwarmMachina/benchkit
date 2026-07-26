import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'
import { ProcessMemorySampler } from '../../measurement/process-memory.js'
import type { LoadCoordinatorOptions, LoadCoordinatorParameters, LoadPhaseResult } from './load-coordinator-context.js'
import type { LoadWorkerCommand, LoadWorkerData, LoadWorkerMessage, LoadWorkerResult } from './load-worker-protocol.js'

export abstract class LoadCoordinator<
  Parameters extends LoadCoordinatorParameters,
  Options extends LoadCoordinatorOptions<Parameters>,
  WorkerData extends LoadWorkerData,
  WorkerResult extends LoadWorkerResult
> {
  protected readonly options: Options

  readonly #workers: Worker[] = []
  readonly #memory = new ProcessMemorySampler()

  #memoryStarted = false

  protected constructor(options: Options) {
    this.options = options
  }

  protected abstract readonly loadName: string
  protected abstract readonly workerUrl: URL

  protected abstract buildWorkerData(workerIndex: number, connections: number): WorkerData

  async run(): Promise<LoadPhaseResult<WorkerResult>> {
    this.#throwIfAborted()

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
    const { parameters } = this.options
    const baseConnections = Math.floor(parameters.connections / parameters.workers)
    const extraConnections = parameters.connections % parameters.workers

    for (let index = 0; index < parameters.workers; index++) {
      const connections = baseConnections + (index < extraConnections ? 1 : 0)
      const workerData = this.buildWorkerData(index, connections)

      this.#workers.push(new Worker(this.workerUrl, { workerData }))
    }
  }

  async #waitForWorkersReady(): Promise<void> {
    await Promise.all(
      this.#workers.map((worker) =>
        this.#waitForWorkerMessage(worker, 'ready', this.options.startupTimeoutMs, `${this.loadName} worker startup`)
      )
    )
  }

  async #runWarmup(): Promise<void> {
    const { warmupMs, timeoutMs } = this.options.parameters

    if (warmupMs <= 0) {
      return
    }

    const results = this.#workers.map((worker) =>
      this.#waitForWorkerMessage(worker, 'warmup-complete', warmupMs + timeoutMs + 5_000, `${this.loadName} warmup`)
    )

    this.#startWorkerPhase('warmup', warmupMs)
    await Promise.all(results)
  }

  async #runMeasurement(): Promise<LoadPhaseResult<WorkerResult>> {
    const { durationMs, timeoutMs } = this.options.parameters
    const results = this.#workers.map((worker) =>
      this.#waitForWorkerMessage(worker, 'result', durationMs + timeoutMs + 5_000, `${this.loadName} measurement`)
    )
    const startedAt = new Date()
    const eluBefore = performance.eventLoopUtilization()
    const cpuBefore = process.cpuUsage()

    this.#memory.start({ sampleMs: this.options.memorySampleMs })
    this.#memoryStarted = true
    this.#startWorkerPhase('measurement', durationMs)

    const messages = await Promise.all(results)
    const finishedAt = new Date()
    const elu = performance.eventLoopUtilization(eluBefore)
    const cpu = process.cpuUsage(cpuBefore)
    const processMemory = this.#memory.stop()

    this.#memoryStarted = false

    if (!processMemory) {
      throw new Error(`${this.loadName} load process memory sampler did not produce a result`)
    }

    const workerResults = messages.map((message) => message.result)

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
    const command: LoadWorkerCommand = {
      type: 'start',
      phase,
      durationMs
    }

    for (const worker of this.#workers) {
      worker.postMessage(command)
    }
  }

  #waitForWorkerMessage<Type extends LoadWorkerMessage<WorkerResult>['type']>(
    worker: Worker,
    expectedType: Type,
    timeoutMs: number,
    phase: string
  ): Promise<Extract<LoadWorkerMessage<WorkerResult>, { type: Type }>> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`${phase} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      const onMessage = (message: LoadWorkerMessage<WorkerResult>): void => {
        if (message.type === 'fatal') {
          cleanup()
          reject(new Error(`${this.loadName} worker failed: ${message.error}`))

          return
        }

        if (message.type === expectedType) {
          cleanup()
          resolve(message as Extract<LoadWorkerMessage<WorkerResult>, { type: Type }>)
        }
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const onExit = (code: number): void => {
        cleanup()
        reject(new Error(`${this.loadName} worker exited before ${expectedType} with code ${code}`))
      }
      const onAbort = (): void => {
        cleanup()
        reject(this.#abortError())
      }
      const cleanup = (): void => {
        clearTimeout(timeout)
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        this.options.signal?.removeEventListener('abort', onAbort)
      }

      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      this.options.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  #throwIfAborted(): void {
    if (this.options.signal?.aborted) {
      throw this.#abortError()
    }
  }

  #abortError(): Error {
    const error = new Error(`${this.loadName} load was aborted`)

    error.name = 'AbortError'

    return error
  }
}
