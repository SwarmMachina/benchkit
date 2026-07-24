import net from 'node:net'
import { InvalidStateError, ProtocolError, TargetUnreachableError } from '../control/errors.js'
import { TargetStateMachine, type TargetState } from '../control/state-machine.js'
import type { MetricsStartOptions, MetricsSummary } from '../measurement/metrics.js'
import type { TimeoutOptions } from '../control/config.js'
import type { EnvironmentSnapshot } from '../control/environment.js'
import type { ReachabilityOptions, TargetEndpoint, TargetSession } from './types.js'
import { ControlClient } from './control-client.js'

function probe(endpoint: TargetEndpoint, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint)
    const cleanup = () => socket.removeAllListeners()

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      cleanup()
      socket.destroy()
      resolve()
    })
    socket.once('timeout', () => {
      cleanup()
      socket.destroy()
      reject(new Error(`TCP probe timed out after ${timeoutMs}ms`))
    })
    socket.once('error', (error) => {
      cleanup()
      socket.destroy()
      reject(error)
    })
  })
}

export class ManagedTargetSession implements TargetSession {
  readonly endpoint: TargetEndpoint
  readonly targetEnvironment: EnvironmentSnapshot
  readonly #bindHost: string
  readonly #client: ControlClient
  readonly #timeouts: TimeoutOptions
  readonly #machine = new TargetStateMachine('ready')

  constructor(options: {
    endpoint: TargetEndpoint
    bindHost: string
    targetEnvironment: EnvironmentSnapshot
    client: ControlClient
    timeouts: TimeoutOptions
  }) {
    this.endpoint = options.endpoint
    this.#bindHost = options.bindHost
    this.targetEnvironment = options.targetEnvironment
    this.#client = options.client
    this.#timeouts = options.timeouts
    this.#client.onFailure(() => {
      if (this.#machine.canTransition('failed')) {
        this.#machine.transition('failed')
      }
    })
  }

  get state(): TargetState {
    return this.#machine.state
  }

  get diagnostics(): string {
    return this.#client.diagnostics
  }

  async startMetrics(options: MetricsStartOptions = {}): Promise<void> {
    this.#machine.assertCanTransition('measuring')

    await this.#client.request('metrics:start', options, this.#timeouts.commandMs)
    this.#machine.transition('measuring')
  }

  async stopMetrics(): Promise<MetricsSummary> {
    this.#machine.assertCanTransition('ready')

    const response = await this.#client.request('metrics:stop', {}, this.#timeouts.commandMs)

    if (response.payload === null || typeof response.payload !== 'object') {
      throw new ProtocolError('metrics:stop response did not contain a metrics summary')
    }

    this.#machine.transition('ready')

    return response.payload as MetricsSummary
  }

  async waitReachable({
    timeoutMs = this.#timeouts.reachabilityMs,
    retryMs = this.#timeouts.reachabilityRetryMs,
    verify
  }: ReachabilityOptions = {}): Promise<void> {
    if (this.state !== 'ready' && this.state !== 'measuring') {
      throw new InvalidStateError(this.state, 'ready', ['ready', 'measuring'])
    }

    const deadline = performance.now() + timeoutMs

    let lastError: unknown = new Error('TCP probe was not attempted')

    while (performance.now() < deadline) {
      const remaining = Math.max(1, deadline - performance.now())

      try {
        await probe(this.endpoint, Math.min(1_000, remaining))

        if (verify) {
          await verify(this.endpoint)
        }

        return
      } catch (error) {
        lastError = error
      }

      const delayMs = Math.min(retryMs, Math.max(0, deadline - performance.now()))

      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
      }
    }

    throw new TargetUnreachableError({
      bindHost: this.#bindHost,
      connectHost: this.endpoint.host,
      port: this.endpoint.port,
      lastNetworkError: lastError instanceof Error ? lastError.message : String(lastError)
    })
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return
    }

    if (this.state === 'failed') {
      await this.#client.close(this.#timeouts.killMs)

      return
    }

    this.#machine.assertCanTransition('stopping')

    this.#machine.transition('stopping')

    try {
      await this.#client.request('target:stop', {}, this.#timeouts.shutdownGraceMs + this.#timeouts.killMs * 2)
      this.#machine.transition('stopped')
    } catch (error) {
      if (this.#machine.canTransition('failed')) {
        this.#machine.transition('failed')
      }

      throw error
    } finally {
      await this.#client.close(this.#timeouts.killMs)
    }
  }
}
