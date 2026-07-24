import type { EnvironmentSnapshot } from '../control/environment.js'
import type { MetricsStartOptions, MetricsSummary } from '../measurement/metrics.js'
import type { TargetState } from '../control/state-machine.js'
import type { TimeoutOptions } from '../control/config.js'

/** Network endpoint reported by a managed target. */
export interface TargetEndpoint {
  /** Hostname or IP address used by the load generator. */
  host: string

  /** TCP port selected for the target. */
  port: number
}

/** Local CPU-profile artifact configuration. */
export interface TargetProfileOptions {
  /** Directory that receives profile artifacts. */
  directory: string
}

/** Process and network options used to start one target. */
export interface TargetStartOptions {
  /** Target entry point, resolved from the provider working directory. */
  entrypoint: string

  /** Arguments passed after the target entry point. */
  args?: string[]

  /** Arguments passed to the Node.js executable. */
  execArgv?: string[]

  /** Environment variables added to the target process. */
  env?: Record<string, string>

  /** Port selection configuration. */
  port?: {
    /** Inclusive port range; an ephemeral port is used when omitted. */
    range?: readonly [number, number]
  }

  /** Enables local V8 CPU profiling or supplies its artifact directory. */
  profile?: boolean | TargetProfileOptions
}

/** Options used to verify that a ready target accepts connections. */
export interface ReachabilityOptions {
  /** Overall reachability deadline in milliseconds. */
  timeoutMs?: number

  /** Delay between failed connection attempts in milliseconds. */
  retryMs?: number

  /** Optional application-level readiness check run after TCP connects. */
  verify?: (endpoint: TargetEndpoint) => void | Promise<void>
}

/** Lifecycle and metrics handle for one managed target process. */
export interface TargetSession {
  /** Endpoint used by the load generator. */
  readonly endpoint: TargetEndpoint

  /** Current target lifecycle state. */
  readonly state: TargetState

  /** Environment snapshot captured inside the target process. */
  readonly targetEnvironment: EnvironmentSnapshot

  /** Bounded stderr diagnostics collected from the agent and target. */
  readonly diagnostics: string

  /** Starts target-side metrics collection and enters `measuring`. */
  startMetrics(options?: MetricsStartOptions): Promise<void>

  /** Stops target-side metrics collection, returns it, and re-enters `ready`. */
  stopMetrics(): Promise<MetricsSummary>

  /** Waits until the reported endpoint passes TCP and optional custom checks. */
  waitReachable(options?: ReachabilityOptions): Promise<void>

  /** Gracefully stops the target and its control agent. */
  stop(): Promise<void>
}

/** Options shared by local and SSH target providers. */
interface CommonProviderOptions {
  /** Address passed to the target for listening. */
  bindHost?: string

  /** Address used by the load generator to connect. */
  connectHost?: string

  /** Overrides for individual lifecycle deadlines. */
  timeouts?: Partial<TimeoutOptions>

  /** Maximum retained stderr diagnostic bytes. */
  diagnosticsMaxBytes?: number
}

/** Configuration for targets started as local child processes. */
export interface LocalTargetProviderOptions extends CommonProviderOptions {
  /** Selects local child-process transport. */
  mode: 'local'

  /**
   * Working directory for the target and agent.
   * @default `process.cwd()`
   */
  cwd?: string
}

/** Configuration for targets started through SSH. */
export interface SshTargetProviderOptions extends CommonProviderOptions {
  /** Selects SSH transport. */
  mode: 'ssh'

  /** Reachable target host or IP; wildcard addresses are rejected. */
  connectHost: string

  /** SSH destination and remote execution configuration. */
  ssh: {
    /** OpenSSH destination such as `bench@example.com`. */
    destination: string

    /** Existing remote working directory. */
    cwd: string

    /** Remote agent executable or command. */
    agentCommand?: string
  }
}

/** Local or SSH managed-target provider configuration. */
export type TargetProviderOptions = LocalTargetProviderOptions | SshTargetProviderOptions

/** Factory-owned configuration capable of starting target sessions. */
export interface TargetProvider {
  /** Selected local or SSH transport mode. */
  readonly mode: TargetProviderOptions['mode']

  /** Address supplied to the target process for listening. */
  readonly bindHost: string

  /** Address used by the load generator. */
  readonly connectHost: string

  /** Starts a target and resolves after IPC readiness. */
  start(options: TargetStartOptions): Promise<TargetSession>
}

/** Normalized configuration encoded into the target agent process. */
export interface AgentConfiguration {
  /** Expected control protocol version. */
  protocolVersion: number

  /** Expected Benchkit package version. */
  benchkitVersion: string

  /** Maximum retained target and agent stderr bytes. */
  diagnosticsMaxBytes: number

  /** Per-command timeout in milliseconds. */
  commandMs: number

  /** Graceful target shutdown deadline in milliseconds. */
  shutdownGraceMs: number

  /** Forced target shutdown deadline in milliseconds. */
  killMs: number
}

/** Fully normalized target start request used by the control agent. */
export interface ResolvedTargetStart {
  /** Absolute or provider-resolved working directory. */
  cwd: string

  /** Target listen address. */
  bindHost: string

  /** Target entry point. */
  entrypoint: string

  /** Target arguments. */
  args: string[]

  /** Node.js executable arguments. */
  execArgv: string[]

  /** Complete target environment additions. */
  env: Record<string, string>

  /** Inclusive port range when explicitly configured. */
  portRange?: readonly [number, number]

  /** Disabled profiling or normalized local artifact configuration. */
  profile: false | TargetProfileOptions

  /** IPC readiness deadline in milliseconds. */
  targetReadyTimeoutMs: number
}

/** Successful target-start payload returned by the control agent. */
export interface TargetStartResponse {
  /** Selected TCP port. */
  port: number

  /** Address passed to the target for listening. */
  bindHost: string

  /** Environment snapshot captured by the target process. */
  environment: EnvironmentSnapshot
}
