import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import {
  BenchkitError,
  ProtocolError,
  TimeoutError,
  TransportError,
  VersionMismatchError,
  errorFromSerialized
} from '../control/errors.js'
import { NdjsonDecoder, encodeNdjson } from '../control/ndjson.js'
import { parseResponse, type ControlEvent, type ControlResponse, type RequestType } from '../control/protocol.js'
import { isRecord } from '../control/value-guards.js'
import { BENCHKIT_VERSION, PROTOCOL_VERSION } from '../control/version.js'

interface PendingRequest {
  type: RequestType
  resolve: (response: ControlResponse) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface AgentReadyPayload {
  protocolVersion: number
  benchkitVersion: string
}

export class ControlClient {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #diagnosticsMaxBytes: number
  #diagnostics = ''
  #pending = new Map<string, PendingRequest>()
  #counter = 0
  #failureListeners = new Set<(error: unknown) => void>()
  #readyResolve!: (payload: AgentReadyPayload) => void
  #readyReject!: (error: unknown) => void
  #ready: Promise<AgentReadyPayload>
  #closed = false
  #failure: unknown = null

  constructor(child: ChildProcessWithoutNullStreams, diagnosticsMaxBytes: number) {
    this.#child = child
    this.#diagnosticsMaxBytes = diagnosticsMaxBytes
    this.#ready = new Promise((resolve, reject) => {
      this.#readyResolve = resolve
      this.#readyReject = reject
    })

    const decoder = new NdjsonDecoder({
      onMessage: (message) => {
        try {
          this.#onMessage(parseResponse(message))
        } catch (error) {
          this.#fail(error)
        }
      },
      onError: (error) => this.#fail(error)
    })

    child.stdout.on('data', (chunk: Buffer) => decoder.push(chunk))
    child.stdout.once('end', () => decoder.end())
    child.stderr.on('data', (chunk: Buffer) => this.#appendDiagnostics(chunk.toString()))
    child.once('error', (error) =>
      this.#fail(new TransportError('Control transport failed', undefined, { cause: error }))
    )
    child.once('exit', (code, signal) => {
      if (!this.#closed) {
        this.#fail(
          new TransportError(`Control transport exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`, {
            code,
            signal,
            diagnostics: this.#diagnostics
          })
        )
      }
    })
  }

  get diagnostics(): string {
    return this.#diagnostics
  }

  async waitForAgent(timeoutMs: number): Promise<void> {
    const payload = await this.#withTimeout(this.#ready, 'agent startup', timeoutMs)

    if (payload.protocolVersion !== PROTOCOL_VERSION) {
      throw new VersionMismatchError('protocol', PROTOCOL_VERSION, payload.protocolVersion)
    }

    if (payload.benchkitVersion !== BENCHKIT_VERSION) {
      throw new VersionMismatchError('package', BENCHKIT_VERSION, payload.benchkitVersion)
    }
  }

  onFailure(listener: (error: unknown) => void): () => void {
    this.#failureListeners.add(listener)

    if (this.#failure) {
      listener(this.#failure)
    }

    return () => this.#failureListeners.delete(listener)
  }

  async request(type: RequestType, payload: unknown, timeoutMs: number): Promise<ControlResponse> {
    if (this.#failure) {
      throw this.#failure
    }

    if (this.#closed || !this.#child.stdin.writable) {
      throw new TransportError('Control transport is closed')
    }

    const id = `${process.pid}-${++this.#counter}`
    const response = new Promise<ControlResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new TimeoutError(type, timeoutMs))
      }, timeoutMs)

      this.#pending.set(id, { type, resolve, reject, timer })
    })

    try {
      if (
        !this.#child.stdin.write(
          encodeNdjson({
            version: PROTOCOL_VERSION,
            id,
            type,
            payload
          })
        )
      ) {
        await once(this.#child.stdin, 'drain')
      }
    } catch (error) {
      const pending = this.#pending.get(id)

      if (pending) {
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        pending.reject(error)
      }
    }

    return response
  }

  async close(timeoutMs: number): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#closed = true

    if (this.#child.stdin.writable) {
      this.#child.stdin.end()
    }

    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      return
    }

    const exited = await Promise.race([
      once(this.#child, 'exit').then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))
    ])

    if (!exited) {
      this.#child.kill('SIGTERM')
      await Promise.race([once(this.#child, 'exit'), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))])
    }
  }

  #onMessage(message: ControlResponse | ControlEvent): void {
    if (message.id === null) {
      if (message.type === 'agent:ready' && message.status === 'ok') {
        if (!isRecord(message.payload)) {
          throw new ProtocolError('agent:ready event has no payload')
        }

        this.#readyResolve(message.payload as unknown as AgentReadyPayload)

        return
      }

      if (message.status === 'error' && message.error) {
        this.#fail(errorFromSerialized(message.error))
      }

      return
    }

    const pending = this.#pending.get(message.id)

    if (!pending) {
      throw new ProtocolError(`Received response for unknown request id "${message.id}"`)
    }

    clearTimeout(pending.timer)
    this.#pending.delete(message.id)

    if (pending.type !== message.type) {
      pending.reject(new ProtocolError(`Response type "${message.type}" does not match request "${pending.type}"`))

      return
    }

    if (message.status === 'error') {
      pending.reject(
        message.error ? errorFromSerialized(message.error) : new ProtocolError('Error response has no serialized error')
      )
    } else {
      pending.resolve(message)
    }
  }

  #appendDiagnostics(text: string): void {
    this.#diagnostics += text
    const bytes = Buffer.byteLength(this.#diagnostics)

    if (bytes > this.#diagnosticsMaxBytes) {
      this.#diagnostics = Buffer.from(this.#diagnostics)
        .subarray(bytes - this.#diagnosticsMaxBytes)
        .toString()
    }
  }

  #fail(error: unknown): void {
    if (this.#failure) {
      return
    }

    this.#failure = error instanceof Error ? error : new BenchkitError('Unknown control transport failure')
    this.#readyReject(this.#failure)

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(this.#failure)
    }

    this.#pending.clear()

    for (const listener of this.#failureListeners) {
      listener(this.#failure)
    }
  }

  async #withTimeout<T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new TimeoutError(operation, timeoutMs)), timeoutMs)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
}
