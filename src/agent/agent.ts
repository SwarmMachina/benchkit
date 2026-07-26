import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  BenchkitError,
  ConfigurationError,
  InvalidStateError,
  ProtocolError,
  TimeoutError,
  errorFromSerialized,
  serializeError
} from '../control/errors.js'
import { snapshotEnvironment } from '../control/environment.js'
import { validateHost, validatePortRange } from '../control/config.js'
import { parseRequest, type ControlEvent, type ControlRequest, type ControlResponse } from '../control/protocol.js'
import { TargetStateMachine } from '../control/state-machine.js'
import { isPort, requireNulFreeStringArray, requireStringRecord } from '../control/value-guards.js'
import { BENCHKIT_VERSION, PROTOCOL_VERSION } from '../control/version.js'
import getFreePort from '../orchestration/get-free-port.js'
import { terminateChildProcess, waitForChildExit } from '../orchestration/managed-child-process.js'
import { isRuntimeResponse, type RuntimeCommandType, type RuntimeReady } from '../target/protocol.js'
import type {
  AgentConfiguration,
  ResolvedTargetStart,
  TargetProfileOptions,
  TargetStartResponse
} from '../target-provider/types.js'
import { isPositiveFiniteNumber, isRecord } from '../validation/predicates.js'

type WriteControl = (message: ControlResponse | ControlEvent) => Promise<void>

interface PendingTargetRequest {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

function validateStart(value: unknown): ResolvedTargetStart {
  if (!isRecord(value)) {
    throw new ConfigurationError('target:start payload must be an object')
  }

  if (typeof value.cwd !== 'string' || value.cwd.length === 0 || value.cwd.includes('\0')) {
    throw new ConfigurationError('target cwd must be a non-empty path')
  }

  if (typeof value.entrypoint !== 'string' || value.entrypoint.length === 0 || value.entrypoint.includes('\0')) {
    throw new ConfigurationError('target entrypoint must be a non-empty path')
  }

  if (!isPositiveFiniteNumber(value.targetReadyTimeoutMs)) {
    throw new ConfigurationError('targetReadyTimeoutMs must be positive')
  }

  const portRange = value.portRange === undefined ? undefined : validatePortRange(value.portRange)

  let profile: false | TargetProfileOptions = false

  if (value.profile !== false) {
    if (
      !isRecord(value.profile) ||
      typeof value.profile.directory !== 'string' ||
      value.profile.directory.length === 0
    ) {
      throw new ConfigurationError('target profile must be false or contain a directory')
    }

    profile = { directory: value.profile.directory }
  }

  return {
    cwd: value.cwd,
    bindHost: validateHost(value.bindHost, 'target bindHost'),
    entrypoint: value.entrypoint,
    args: requireNulFreeStringArray(value.args, 'target args'),
    execArgv: requireNulFreeStringArray(value.execArgv, 'target execArgv'),
    env: requireStringRecord(value.env, 'target env'),
    ...(portRange ? { portRange } : {}),
    profile,
    targetReadyTimeoutMs: value.targetReadyTimeoutMs as number
  }
}

function forwardOutput(stream: NodeJS.ReadableStream | null, label: string): void {
  stream?.on('data', (chunk: Buffer | string) => {
    const writable = process.stderr.write(`[target:${label}] ${chunk.toString()}`)

    if (!writable && 'pause' in stream && typeof stream.pause === 'function') {
      stream.pause()
      process.stderr.once('drain', () => {
        if ('resume' in stream && typeof stream.resume === 'function') {
          stream.resume()
        }
      })
    }
  })
}

export class BenchkitAgent {
  readonly #config: AgentConfiguration
  readonly #write: WriteControl
  #machine: TargetStateMachine | null = null
  #target: ChildProcess | null = null
  #targetExpectedExit = false
  #closed = false
  #pendingTarget = new Map<string, PendingTargetRequest>()

  constructor(config: AgentConfiguration, write: WriteControl) {
    this.#config = config
    this.#write = write
  }

  async announce(): Promise<void> {
    await this.#write({
      version: PROTOCOL_VERSION,
      id: null,
      type: 'agent:ready',
      status: 'ok',
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        benchkitVersion: BENCHKIT_VERSION,
        environment: snapshotEnvironment()
      }
    })
  }

  async handle(value: unknown): Promise<void> {
    let request: ControlRequest

    try {
      request = parseRequest(value)
    } catch (error) {
      if (isRecord(value) && typeof value.id === 'string' && typeof value.type === 'string') {
        await this.#write({
          version: PROTOCOL_VERSION,
          id: value.id,
          type: value.type as ControlRequest['type'],
          status: 'error',
          ...(this.#machine ? { state: this.#machine.state } : {}),
          error: serializeError(error)
        })

        return
      }

      throw error
    }

    try {
      const payload = await this.#dispatch(request)

      await this.#write({
        version: PROTOCOL_VERSION,
        id: request.id,
        type: request.type,
        status: 'ok',
        ...(this.#machine ? { state: this.#machine.state } : {}),
        payload: payload ?? {}
      })
    } catch (error) {
      await this.#write({
        version: PROTOCOL_VERSION,
        id: request.id,
        type: request.type,
        status: 'error',
        ...(this.#machine ? { state: this.#machine.state } : {}),
        error: serializeError(error)
      })
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#closed = true
    await this.#terminateTarget()
  }

  async #dispatch(request: ControlRequest): Promise<unknown> {
    if (request.type === 'target:start') {
      if (this.#machine) {
        throw new InvalidStateError(this.#machine.state, 'starting', [])
      }

      return this.#start(request.payload)
    }

    if (!this.#machine || !this.#target) {
      throw new ProtocolError('target:start must complete before target commands')
    }

    if (request.type === 'metrics:start') {
      this.#machine.assertCanTransition('measuring')

      await this.#requestTarget('benchkit:metrics:start', request.id, request.payload, this.#config.commandMs)
      this.#machine.transition('measuring')

      return {}
    }

    if (request.type === 'metrics:stop') {
      this.#machine.assertCanTransition('ready')

      const metrics = await this.#requestTarget(
        'benchkit:metrics:stop',
        request.id,
        request.payload,
        this.#config.commandMs
      )

      this.#machine.transition('ready')

      return metrics
    }

    this.#machine.assertCanTransition('stopping')

    this.#machine.transition('stopping')
    await this.#terminateTarget()
    this.#machine.transition('stopped')

    return {}
  }

  async #start(value: unknown): Promise<TargetStartResponse> {
    const start = validateStart(value)
    const machine = new TargetStateMachine()

    this.#machine = machine

    try {
      const port = await getFreePort({
        host: start.bindHost,
        ...(start.portRange ? { range: start.portRange } : {})
      })
      const entrypoint = path.isAbsolute(start.entrypoint)
        ? start.entrypoint
        : path.resolve(start.cwd, start.entrypoint)
      const profileDirectory = start.profile ? path.resolve(start.profile.directory) : null

      if (profileDirectory) {
        await fs.mkdir(profileDirectory, { recursive: true })
      }

      const child = fork(entrypoint, [...start.args, '--port', String(port), '--host', start.bindHost], {
        cwd: profileDirectory ?? start.cwd,
        detached: process.platform !== 'win32',
        execArgv: [...start.execArgv, ...(start.profile ? ['--prof'] : [])],
        env: { ...process.env, ...start.env },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })

      this.#target = child
      forwardOutput(child.stdout, 'stdout')
      forwardOutput(child.stderr, 'stderr')
      child.on('message', (message) => this.#onTargetMessage(message))
      child.once('error', (error) => this.#rejectPendingTarget(error))
      child.once('exit', (code, signal) => {
        const error = new BenchkitError(
          `Target exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          'TARGET_EXITED',
          { code, signal }
        )

        this.#rejectPendingTarget(error)

        if (!this.#targetExpectedExit && this.#machine && this.#machine.canTransition('failed')) {
          this.#machine.transition('failed')
          void this.#write({
            version: PROTOCOL_VERSION,
            id: null,
            type: 'target:exit',
            status: 'error',
            state: this.#machine.state,
            error: serializeError(error)
          }).catch(() => {})
        }
      })

      const ready = await this.#waitForTargetReady(child, start.targetReadyTimeoutMs)

      machine.transition('ready')

      return {
        port: ready.payload.port,
        bindHost: start.bindHost,
        environment: snapshotEnvironment()
      }
    } catch (error) {
      if (machine.canTransition('failed')) {
        machine.transition('failed')
      }

      await this.#terminateTarget()
      throw error
    }
  }

  #waitForTargetReady(child: ChildProcess, timeoutMs: number): Promise<RuntimeReady> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        child.off('message', onMessage)
        child.off('exit', onExit)
        child.off('error', onError)
      }
      const onMessage = (value: unknown) => {
        if (!isRecord(value) || value.type !== 'benchkit:ready' || !isRecord(value.payload)) {
          return
        }

        const port = value.payload.port

        if (!isPort(port)) {
          cleanup()
          reject(new ProtocolError('Target returned an invalid ready port', value))

          return
        }

        cleanup()
        resolve(value as unknown as RuntimeReady)
      }
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup()
        reject(
          new BenchkitError(
            `Target exited before ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
            'TARGET_EXITED_BEFORE_READY',
            { code, signal }
          )
        )
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new TimeoutError('target readiness', timeoutMs))
      }, timeoutMs)

      child.on('message', onMessage)
      child.once('exit', onExit)
      child.once('error', onError)
    })
  }

  #onTargetMessage(value: unknown): void {
    if (!isRuntimeResponse(value)) {
      return
    }

    const pending = this.#pendingTarget.get(value.id)

    if (!pending) {
      return
    }

    clearTimeout(pending.timer)
    this.#pendingTarget.delete(value.id)

    if (value.status === 'ok') {
      pending.resolve(value.payload)
    } else if (value.error) {
      pending.reject(errorFromSerialized(value.error))
    } else {
      pending.reject(new ProtocolError('Target returned an error response without error details'))
    }
  }

  #requestTarget(type: RuntimeCommandType, id: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    const target = this.#target

    if (!target?.connected) {
      return Promise.reject(new BenchkitError('Target IPC channel is not connected', 'IPC_UNAVAILABLE'))
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingTarget.delete(id)
        reject(new TimeoutError(type, timeoutMs))
      }, timeoutMs)

      this.#pendingTarget.set(id, { resolve, reject, timer })
      target.send({ type, id, payload }, (error) => {
        if (error) {
          clearTimeout(timer)
          this.#pendingTarget.delete(id)
          reject(error)
        }
      })
    })
  }

  #rejectPendingTarget(error: unknown): void {
    for (const pending of this.#pendingTarget.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }

    this.#pendingTarget.clear()
  }

  async #terminateTarget(): Promise<void> {
    const target = this.#target

    if (!target || target.exitCode !== null || target.signalCode !== null) {
      return
    }

    this.#targetExpectedExit = true
    const gracefulStartedAt = performance.now()

    if (target.connected) {
      try {
        await this.#requestTarget('benchkit:shutdown', `shutdown-${process.pid}`, {}, this.#config.shutdownGraceMs)
      } catch {
        // Continue with signals.
      }
    }

    const gracefulRemainingMs = Math.max(1, this.#config.shutdownGraceMs - (performance.now() - gracefulStartedAt))

    if (await waitForChildExit(target, gracefulRemainingMs)) {
      return
    }

    await terminateChildProcess(target, {
      graceMs: this.#config.killMs,
      killMs: this.#config.killMs,
      killTree: true
    })
  }
}
