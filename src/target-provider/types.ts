import type { EnvironmentSnapshot } from '../control/environment.js'
import type { MetricsStartOptions, MetricsSummary } from '../measurement/metrics.js'
import type { TargetState } from '../control/state-machine.js'
import type { TimeoutOptions } from '../control/config.js'

export interface TargetEndpoint {
  host: string
  port: number
}

export interface TargetProfileOptions {
  directory: string
}

export interface TargetStartOptions {
  entrypoint: string
  args?: string[]
  execArgv?: string[]
  env?: Record<string, string>
  port?: {
    range?: readonly [number, number]
  }
  profile?: boolean | TargetProfileOptions
}

export interface ReachabilityOptions {
  timeoutMs?: number
  retryMs?: number
  verify?: (endpoint: TargetEndpoint) => void | Promise<void>
}

export interface TargetSession {
  readonly endpoint: TargetEndpoint
  readonly state: TargetState
  readonly targetEnvironment: EnvironmentSnapshot
  readonly diagnostics: string
  startMetrics(options?: MetricsStartOptions): Promise<void>
  stopMetrics(): Promise<MetricsSummary>
  waitReachable(options?: ReachabilityOptions): Promise<void>
  stop(): Promise<void>
}

interface CommonProviderOptions {
  bindHost?: string
  connectHost?: string
  timeouts?: Partial<TimeoutOptions>
  diagnosticsMaxBytes?: number
}

export interface LocalTargetProviderOptions extends CommonProviderOptions {
  mode: 'local'
  cwd?: string
}

export interface SshTargetProviderOptions extends CommonProviderOptions {
  mode: 'ssh'
  connectHost: string
  ssh: {
    destination: string
    cwd: string
    agentCommand?: string
  }
}

export type TargetProviderOptions = LocalTargetProviderOptions | SshTargetProviderOptions

export interface TargetProvider {
  readonly mode: TargetProviderOptions['mode']
  readonly bindHost: string
  readonly connectHost: string
  start(options: TargetStartOptions): Promise<TargetSession>
}

export interface AgentConfiguration {
  protocolVersion: number
  benchkitVersion: string
  diagnosticsMaxBytes: number
  commandMs: number
  shutdownGraceMs: number
  killMs: number
}

export interface ResolvedTargetStart {
  cwd: string
  bindHost: string
  entrypoint: string
  args: string[]
  execArgv: string[]
  env: Record<string, string>
  portRange?: readonly [number, number]
  profile: false | TargetProfileOptions
  targetReadyTimeoutMs: number
}

export interface TargetStartResponse {
  port: number
  bindHost: string
  environment: EnvironmentSnapshot
}
