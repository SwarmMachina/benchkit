import { BenchkitError, serializeError } from '../control/errors.js'
import { isPort } from '../control/value-guards.js'
import Metrics, { type MetricsStartOptions, type MetricsSummary } from '../measurement/metrics.js'
import { isRuntimeCommand, type RuntimeCommand, type RuntimeReady, type RuntimeResponse } from './protocol.js'

export type TargetReadyPayload = RuntimeReady['payload']

export interface TargetRuntimeOptions {
  metrics?: boolean
  exitOnSignal?: boolean
}

export interface TargetRuntime {
  registerShutdown(hook: () => void | Promise<void>): () => void
  ready(payload: TargetReadyPayload): void
  shutdown(): Promise<void>
  dispose(): void
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

export function createTargetRuntime({
  metrics: metricsEnabled = true,
  exitOnSignal = true
}: TargetRuntimeOptions = {}): TargetRuntime {
  const metrics = metricsEnabled ? new Metrics() : null
  const shutdownHooks = new Set<() => void | Promise<void>>()

  let measuring = false
  let shuttingDown: Promise<void> | null = null
  let disposed = false

  const shutdown = (): Promise<void> => {
    if (shuttingDown) {
      return shuttingDown
    }

    shuttingDown = (async () => {
      if (measuring) {
        metrics?.stop()
        measuring = false
      }

      const errors: unknown[] = []

      for (const hook of [...shutdownHooks].reverse()) {
        try {
          await hook()
        } catch (error) {
          errors.push(error)
        }
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, 'One or more target shutdown hooks failed')
      }
    })()

    return shuttingDown
  }
  const respond = async (command: RuntimeCommand, operation: () => unknown | Promise<unknown>) => {
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
  const onMessage = (value: unknown) => {
    if (!isRuntimeCommand(value)) {
      return
    }

    if (value.type === 'benchkit:metrics:start') {
      void respond(value, () => {
        if (!metrics) {
          throw new BenchkitError('Metrics are disabled for this target runtime', 'METRICS_DISABLED')
        }

        if (measuring) {
          throw new BenchkitError('Metrics collection is already running', 'METRICS_ALREADY_RUNNING')
        }

        const payload =
          value.payload !== null && typeof value.payload === 'object'
            ? (value.payload as MetricsStartOptions)
            : ({} as MetricsStartOptions)

        metrics.start(payload)
        measuring = true

        return {}
      })

      return
    }

    if (value.type === 'benchkit:metrics:stop') {
      void respond(value, (): MetricsSummary => {
        if (!metrics || !measuring) {
          throw new BenchkitError('Metrics collection is not running', 'METRICS_NOT_RUNNING')
        }

        const summary = metrics.stop()

        measuring = false

        if (!summary) {
          throw new BenchkitError('Metrics collection returned no summary', 'METRICS_EMPTY')
        }

        return summary
      })

      return
    }

    void respond(value, shutdown).finally(() => {
      if (exitOnSignal) {
        process.exit(process.exitCode ?? 0)
      }
    })
  }
  const onSignal = () => {
    void shutdown().finally(() => {
      if (exitOnSignal) {
        process.exit(process.exitCode ?? 0)
      }
    })
  }

  process.on('message', onMessage)
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  return {
    registerShutdown(hook) {
      if (disposed || shuttingDown) {
        throw new BenchkitError('Cannot register a shutdown hook after shutdown has started', 'RUNTIME_SHUTTING_DOWN')
      }

      shutdownHooks.add(hook)

      return () => shutdownHooks.delete(hook)
    },
    ready(payload) {
      if (!isPort(payload.port)) {
        throw new BenchkitError('Target ready payload must contain a valid port', 'INVALID_READY_PAYLOAD', payload)
      }

      void send({ type: 'benchkit:ready', payload }).catch((error) => {
        process.emitWarning(error)
      })
    },
    shutdown,
    dispose() {
      if (disposed) {
        return
      }

      disposed = true
      process.off('message', onMessage)
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
    }
  }
}
