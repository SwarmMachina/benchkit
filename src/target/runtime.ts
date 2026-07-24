import { BenchkitError, serializeError } from '../control/errors.js'
import { isPort } from '../control/value-guards.js'
import Metrics, { type MetricsStartOptions, type MetricsSummary } from '../measurement/metrics.js'
import { isRuntimeCommand, type RuntimeCommand, type RuntimeReady, type RuntimeResponse } from './protocol.js'

/** Payload sent when a target announces IPC readiness. */
export type TargetReadyPayload = RuntimeReady['payload']

/** Target-process control runtime configuration. */
export interface TargetRuntimeOptions {
  /**
   * Enables target-side process and event-loop measurement commands.
   * @default `true`
   */
  metrics?: boolean

  /**
   * Exits the process after a shutdown command or termination signal.
   * @default `true`
   */
  exitOnSignal?: boolean
}

function send(message: RuntimeResponse | RuntimeReady): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new BenchkitError('Target runtime requires a Node IPC channel', 'IPC_UNAVAILABLE'))

      return
    }

    process.send(message, undefined, undefined, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/** Target-side lifecycle owner attached to Node.js IPC and process signals. */
export class TargetRuntime {
  readonly #metrics: Metrics | null
  readonly #exitOnSignal: boolean
  readonly #shutdownHooks = new Set<() => void | Promise<void>>()
  #measuring = false
  #shuttingDown: Promise<void> | null = null
  #disposed = false

  /** Attaches the target lifecycle to the current process. */
  constructor({ metrics: metricsEnabled = true, exitOnSignal = true }: TargetRuntimeOptions = {}) {
    this.#metrics = metricsEnabled ? new Metrics() : null
    this.#exitOnSignal = exitOnSignal

    process.on('message', this.#onMessage)
    process.on('SIGTERM', this.#onSignal)
    process.on('SIGINT', this.#onSignal)
  }

  /**
   * Registers a LIFO shutdown hook and returns an unregister callback.
   *
   * Registration after shutdown begins throws.
   */
  registerShutdown(hook: () => void | Promise<void>): () => void {
    if (this.#disposed || this.#shuttingDown) {
      throw new BenchkitError('Cannot register a shutdown hook after shutdown has started', 'RUNTIME_SHUTTING_DOWN')
    }

    this.#shutdownHooks.add(hook)

    return () => this.#shutdownHooks.delete(hook)
  }

  /** Announces the target port and bind address to the control agent. */
  ready(payload: TargetReadyPayload): void {
    if (!isPort(payload.port)) {
      throw new BenchkitError('Target ready payload must contain a valid port', 'INVALID_READY_PAYLOAD', payload)
    }

    void send({ type: 'benchkit:ready', payload }).catch((error) => {
      process.emitWarning(error)
    })
  }

  /** Runs registered shutdown hooks once and returns the shared completion promise. */
  shutdown(): Promise<void> {
    if (this.#shuttingDown) {
      return this.#shuttingDown
    }

    this.#shuttingDown = this.#runShutdown()

    return this.#shuttingDown
  }

  /** Removes IPC and signal listeners without running shutdown hooks. */
  dispose(): void {
    if (this.#disposed) {
      return
    }

    this.#disposed = true
    process.off('message', this.#onMessage)
    process.off('SIGTERM', this.#onSignal)
    process.off('SIGINT', this.#onSignal)
  }

  async #runShutdown(): Promise<void> {
    if (this.#measuring) {
      this.#metrics?.stop()
      this.#measuring = false
    }

    const errors: unknown[] = []

    for (const hook of [...this.#shutdownHooks].reverse()) {
      try {
        await hook()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more target shutdown hooks failed')
    }
  }

  async #respond(command: RuntimeCommand, operation: () => unknown | Promise<unknown>): Promise<void> {
    try {
      const payload = await operation()

      await send({
        type: 'benchkit:response',
        id: command.id,
        status: 'ok',
        payload: payload ?? {}
      })
    } catch (error) {
      await send({
        type: 'benchkit:response',
        id: command.id,
        status: 'error',
        error: serializeError(error)
      }).catch(() => {})
    }
  }

  readonly #onMessage = (value: unknown): void => {
    if (!isRuntimeCommand(value)) {
      return
    }

    if (value.type === 'benchkit:metrics:start') {
      void this.#respond(value, () => {
        if (!this.#metrics) {
          throw new BenchkitError('Metrics are disabled for this target runtime', 'METRICS_DISABLED')
        }

        if (this.#measuring) {
          throw new BenchkitError('Metrics collection is already running', 'METRICS_ALREADY_RUNNING')
        }

        const payload =
          value.payload !== null && typeof value.payload === 'object'
            ? (value.payload as MetricsStartOptions)
            : ({} as MetricsStartOptions)

        this.#metrics.start(payload)
        this.#measuring = true

        return {}
      })

      return
    }

    if (value.type === 'benchkit:metrics:stop') {
      void this.#respond(value, (): MetricsSummary => {
        if (!this.#metrics || !this.#measuring) {
          throw new BenchkitError('Metrics collection is not running', 'METRICS_NOT_RUNNING')
        }

        const summary = this.#metrics.stop()

        this.#measuring = false

        if (!summary) {
          throw new BenchkitError('Metrics collection returned no summary', 'METRICS_EMPTY')
        }

        return summary
      })

      return
    }

    void this.#respond(value, () => this.shutdown()).finally(() => {
      if (this.#exitOnSignal) {
        process.exit(process.exitCode ?? 0)
      }
    })
  }

  readonly #onSignal = (): void => {
    void this.shutdown().finally(() => {
      if (this.#exitOnSignal) {
        process.exit(process.exitCode ?? 0)
      }
    })
  }
}
