import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { BenchkitError, ConfigurationError, ProtocolError, UnsupportedFeatureError } from '../control/errors.js'
import {
  resolveTimeouts,
  validateDestination,
  validateHost,
  validatePortRange,
  type TimeoutOptions
} from '../control/config.js'
import { requireNulFreeStringArray, requireStringRecord } from '../control/value-guards.js'
import { BENCHKIT_VERSION, PROTOCOL_VERSION } from '../control/version.js'
import type {
  AgentConfiguration,
  ResolvedTargetStart,
  TargetProfileOptions,
  TargetProviderOptions,
  TargetSession,
  TargetStartOptions,
  TargetStartResponse
} from './types.js'
import { ControlClient } from './control-client.js'
import { ManagedTargetSession } from './session.js'

const DEFAULT_DIAGNOSTICS_BYTES = 256 * 1024

function resolveProfile(
  profile: TargetStartOptions['profile'],
  mode: TargetProviderOptions['mode'],
  cwd: string
): false | TargetProfileOptions {
  if (!profile) {
    return false
  }

  if (mode === 'ssh') {
    throw new UnsupportedFeatureError('V8 profiling', mode)
  }

  if (profile === true) {
    return { directory: path.resolve(cwd, 'benchkit-profiles') }
  }

  if (typeof profile.directory !== 'string' || profile.directory.length === 0 || profile.directory.includes('\0')) {
    throw new ConfigurationError('profile.directory must be a non-empty path')
  }

  return { directory: path.resolve(profile.directory) }
}

function validateStartOptions(
  options: TargetStartOptions,
  mode: TargetProviderOptions['mode'],
  cwd: string,
  bindHost: string,
  targetReadyTimeoutMs: number
): ResolvedTargetStart {
  if (
    !options ||
    typeof options.entrypoint !== 'string' ||
    options.entrypoint.length === 0 ||
    options.entrypoint.includes('\0')
  ) {
    throw new ConfigurationError('entrypoint must be a non-empty path')
  }

  return {
    cwd,
    bindHost,
    entrypoint: options.entrypoint,
    args: requireNulFreeStringArray(options.args ?? [], 'args'),
    execArgv: requireNulFreeStringArray(options.execArgv ?? [], 'execArgv'),
    env: requireStringRecord(options.env ?? {}, 'env'),
    ...(options.port?.range ? { portRange: validatePortRange(options.port.range) } : {}),
    profile: resolveProfile(options.profile, mode, cwd),
    targetReadyTimeoutMs
  }
}

function validateAgentCommand(command: string): string {
  if (!/^[A-Za-z0-9_./-]+$/u.test(command) || command.startsWith('-')) {
    throw new ConfigurationError('ssh.agentCommand must be a shell-safe executable path')
  }

  return command
}

function resolveAgentCommand(cwd: string, command: string | undefined): string {
  return validateAgentCommand(command ?? path.posix.join(cwd, 'node_modules/.bin/benchkit-agent'))
}

function encodeAgentConfiguration(diagnosticsMaxBytes: number, timeouts: TimeoutOptions): string {
  const value: AgentConfiguration = {
    protocolVersion: PROTOCOL_VERSION,
    benchkitVersion: BENCHKIT_VERSION,
    diagnosticsMaxBytes,
    commandMs: timeouts.commandMs,
    shutdownGraceMs: timeouts.shutdownGraceMs,
    killMs: timeouts.killMs
  }

  return Buffer.from(JSON.stringify(value)).toString('base64')
}

/** Configured local or SSH target launcher. */
export class TargetProvider {
  /** Selected local or SSH transport mode. */
  readonly mode: TargetProviderOptions['mode']

  /** Address supplied to the target process for listening. */
  readonly bindHost: string

  /** Address used by the load generator. */
  readonly connectHost: string

  readonly #options: TargetProviderOptions
  readonly #cwd: string
  readonly #timeouts: TimeoutOptions
  readonly #diagnosticsMaxBytes: number

  /** Validates and retains the configuration used for each target session. */
  constructor(options: TargetProviderOptions) {
    if (!options || (options.mode !== 'local' && options.mode !== 'ssh')) {
      throw new ConfigurationError('Target provider mode must be "local" or "ssh"')
    }

    this.#options = options
    this.mode = options.mode
    this.#timeouts = resolveTimeouts(options.timeouts)
    this.#diagnosticsMaxBytes = options.diagnosticsMaxBytes ?? DEFAULT_DIAGNOSTICS_BYTES

    if (!Number.isInteger(this.#diagnosticsMaxBytes) || this.#diagnosticsMaxBytes < 1024) {
      throw new ConfigurationError('diagnosticsMaxBytes must be an integer of at least 1024 bytes')
    }

    if (options.mode === 'local') {
      this.#cwd = path.resolve(options.cwd ?? process.cwd())
      this.bindHost = validateHost(options.bindHost ?? '127.0.0.1', 'bindHost')
      this.connectHost = validateHost(options.connectHost ?? '127.0.0.1', 'connectHost', { connect: true })
    } else {
      validateDestination(options.ssh.destination)

      if (typeof options.ssh.cwd !== 'string' || options.ssh.cwd.length === 0 || options.ssh.cwd.includes('\0')) {
        throw new ConfigurationError('ssh.cwd must be a non-empty remote path')
      }

      this.#cwd = options.ssh.cwd
      this.bindHost = validateHost(options.bindHost ?? '0.0.0.0', 'bindHost')
      this.connectHost = validateHost(options.connectHost, 'connectHost', { connect: true })
      resolveAgentCommand(this.#cwd, options.ssh.agentCommand)
    }
  }

  /** Starts a target and resolves after IPC readiness. */
  async start(options: TargetStartOptions): Promise<TargetSession> {
    const start = validateStartOptions(options, this.mode, this.#cwd, this.bindHost, this.#timeouts.targetReadyMs)
    const encoded = encodeAgentConfiguration(this.#diagnosticsMaxBytes, this.#timeouts)
    const child = this.#spawnAgent(encoded)
    const client = new ControlClient(child, this.#diagnosticsMaxBytes)

    try {
      await client.waitForAgent(this.#timeouts.agentStartupMs)
      const response = await client.request('target:start', start, this.#timeouts.targetReadyMs)

      if (
        response.payload === null ||
        typeof response.payload !== 'object' ||
        !Number.isInteger((response.payload as Partial<TargetStartResponse>).port)
      ) {
        throw new ProtocolError('target:start response has an invalid payload')
      }

      const payload = response.payload as TargetStartResponse

      return new ManagedTargetSession({
        endpoint: { host: this.connectHost, port: payload.port },
        bindHost: payload.bindHost,
        targetEnvironment: payload.environment,
        client,
        timeouts: this.#timeouts
      })
    } catch (error) {
      await client.close(this.#timeouts.killMs)

      const diagnostics = client.diagnostics

      if (diagnostics && error instanceof BenchkitError) {
        throw new BenchkitError(
          error.message,
          error.code,
          {
            error: error.details,
            diagnostics
          },
          { cause: error }
        )
      }

      throw error
    }
  }

  #spawnAgent(encodedConfiguration: string): ChildProcessWithoutNullStreams {
    if (this.#options.mode === 'local') {
      const agentPath = fileURLToPath(new URL('../agent/cli.js', import.meta.url))

      return spawn(process.execPath, [agentPath, '--stdio', '--config-base64', encodedConfiguration], {
        cwd: this.#cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }

    const ssh = this.#options.ssh
    const connectSeconds = Math.max(1, Math.ceil(this.#timeouts.connectMs / 1000))
    const args = [
      '-o',
      `ConnectTimeout=${connectSeconds}`,
      '--',
      ssh.destination,
      resolveAgentCommand(this.#cwd, ssh.agentCommand),
      '--stdio',
      '--config-base64',
      encodedConfiguration
    ]

    return spawn('ssh', args, {
      stdio: ['pipe', 'pipe', 'pipe']
    })
  }
}
