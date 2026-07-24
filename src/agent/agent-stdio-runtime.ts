import { once } from 'node:events'
import { NdjsonDecoder, encodeNdjson } from '../control/ndjson.js'
import { serializeError } from '../control/errors.js'
import { PROTOCOL_VERSION } from '../control/version.js'
import type { ControlEvent, ControlResponse } from '../control/protocol.js'
import type { AgentConfiguration } from '../target-provider/types.js'
import { BenchkitAgent } from './agent.js'

export class AgentStdioRuntime {
  readonly #agent: BenchkitAgent
  readonly #decoder: NdjsonDecoder

  #writeQueue = Promise.resolve()
  #commandQueue = Promise.resolve()
  #closing: Promise<void> | null = null
  #fatal = false

  constructor(config: AgentConfiguration) {
    this.#agent = new BenchkitAgent(config, (message) => this.#write(message))
    this.#decoder = new NdjsonDecoder({
      onMessage: (message) => this.#enqueue(message),
      onError: (error) => {
        void this.fail(error)
      }
    })
  }

  async start(): Promise<void> {
    process.stdin.on('data', this.#onStdinData)
    process.stdin.once('end', this.#onStdinEnd)
    process.stdin.once('error', this.#onStdinError)
    process.stdout.once('error', this.#onStdoutError)
    process.stderr.on('error', this.#onStderrError)
    process.once('uncaughtException', this.#onUncaughtException)
    process.once('unhandledRejection', this.#onUnhandledRejection)
    process.once('SIGTERM', this.#onTerminationSignal)
    process.once('SIGINT', this.#onTerminationSignal)

    await this.#agent.announce()
    process.stdin.resume()
  }

  close(): Promise<void> {
    if (this.#closing) {
      return this.#closing
    }

    this.#closing = this.#close()

    return this.#closing
  }

  async fail(error: unknown): Promise<void> {
    if (this.#fatal) {
      return
    }

    this.#fatal = true
    // The fatal path must flush its control error before target cleanup.
    // eslint-disable-next-line promise/no-promise-in-callback
    await this.#write({
      version: PROTOCOL_VERSION,
      id: null,
      type: 'agent:error',
      status: 'error',
      error: serializeError(error)
    }).catch(() => {})
    await this.#agent.close()
    process.exit(1)
  }

  #write(message: ControlResponse | ControlEvent): Promise<void> {
    this.#writeQueue = this.#writeQueue.then(async () => {
      if (!process.stdout.write(encodeNdjson(message))) {
        await once(process.stdout, 'drain')
      }

      return undefined
    })

    return this.#writeQueue
  }

  #enqueue(message: unknown): void {
    this.#commandQueue = this.#commandQueue.then(() => this.#agent.handle(message)).catch((error) => this.fail(error))
  }

  async #close(): Promise<void> {
    this.#decoder.end()
    await this.#commandQueue.catch(() => {})
    await this.#agent.close()
  }

  readonly #onStdinData = (chunk: Buffer): void => {
    this.#decoder.push(chunk)
  }

  readonly #onStdinEnd = (): void => {
    void this.close()
  }

  readonly #onStdinError = (error: Error): void => {
    void this.fail(error)
  }

  readonly #onStdoutError = (): void => {
    void this.#agent.close().finally(() => process.exit(1))
  }

  readonly #onStderrError = (): void => {
    // A disconnected runner may close diagnostics before stdin propagation.
  }

  readonly #onUncaughtException = (error: Error): void => {
    void this.fail(error)
  }

  readonly #onUnhandledRejection = (error: unknown): void => {
    void this.fail(error)
  }

  readonly #onTerminationSignal = (): void => {
    void this.close().finally(() => process.exit(0))
  }
}
